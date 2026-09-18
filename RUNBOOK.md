# Precious AI — Runbook

Operational reference for deploying, monitoring, and recovering the system.
Last updated: 2026-09-18 (Vercel serverless + pluggable storage layer).

## 1. Architecture

### Mode A — Split hosting (Vercel UI + small API server)

```
┌─────────────────────┐          ┌──────────────────────────────┐
│  Vercel (static UI) │  HTTPS   │  API server (small VPS)      │
│  web/ + vercel.json │ ───────▶ │  FastAPI (app/) + uvicorn    │
│  *.vercel.app       │  REST    │  SQLite (data/precious.db)   │
│  window.PA_API      │          │  → Groq API (GROQ_API_KEY)   │
└─────────────────────┘          └──────────────────────────────┘
```

- UI: static SPA on Vercel (project root = `web/`, Framework *Other*).
- API: FastAPI + SQLite on a small always-on server with **persistent disk**.
- Glue: `window.PA_API` in `web/config.js` + `PA_CORS_ORIGINS` on the API.

### Mode B — Full Vercel serverless (whole app as serverless functions)

Vercel detects the FastAPI app and runs everything (API + static UI) as
serverless functions. **Two hard rules of this environment:**

1. The application filesystem (`/var/task`) is **READ-ONLY**. The app never
   writes there — runtime data goes to `/tmp/precious-ai`.
2. `/tmp` is **EPHEMERAL**: it lives only as long as one function instance.
   When the instance is recycled (idle timeout, new deployment, region
   switch) everything in `/tmp` — including the default SQLite database —
   is gone.

Therefore, **for real persistence in Mode B you must run Postgres**:

```
Vercel serverless function (read-only /var/task)
   ├── /tmp/precious-ai        ← ephemeral scratch: sqlite (if no PG), uploads,
   │                              model cache (re-downloaded on cold start)
   ├── PA_DATABASE_URL ───────▶ Postgres (Neon / Supabase / Railway / RDS)
   │                              ← ALL durable data (owner, conversations,
   │                                 KB chunks + embeddings, memory, ...)
   └── GROQ_API_KEY ──────────▶ Groq (LLM)
```

The storage backend is selected by `PA_STORAGE` (`sqlite` | `postgres`) and
is fully abstracted in `app/storage/` — switching backends is an env change,
no code change.

### Environment variables

| Variable | Mode A | Mode B (Vercel) | Meaning |
|---|---|---|---|
| `GROQ_API_KEY` | server env | Vercel env | LLM key (server-side only) |
| `PA_CORS_ORIGINS` | server env (UI origin) | not needed | Allowed cross-origin UI origins |
| `PA_STORAGE` | — | `postgres` | `sqlite` (default) or `postgres` |
| `PA_DATABASE_URL` | — | **required when PA_STORAGE=postgres** | Postgres connection string |
| `PA_DATA_DIR` | optional | optional | Override runtime data dir (default `./data`; `/tmp/precious-ai` on Vercel) |
| `PA_MODEL_CACHE_DIR` | optional | optional | Embedding model cache dir |

## 2. Deployment

### 2.1 Mode A — UI on Vercel + API on a server

1. Vercel → New Project → import repo → **Root Directory `web`**, Framework *Other*, no build.
2. Before the first production push, set `window.PA_API` in `web/config.js`.
3. API server: `git pull`, `pip install -r requirements.lock`, restart, `curl /api/health`.

### 2.2 Mode B — full app on Vercel (serverless)

1. Vercel → New Project → import repo → **Root Directory: (repo root, empty)**,
   Framework Preset: **FastAPI** (auto-detected). No build command.
   (The repo-root `vercel.json` sets `maxDuration: 60` for all functions.)
2. Environment variables (Project → Settings → Environment Variables,
   Production + Preview):
   - `GROQ_API_KEY` = your Groq key
   - `PA_STORAGE` = `postgres`
   - `PA_DATABASE_URL` = your Postgres string (e.g. Neon:
     `postgres://user:pass@ep-xxx.aws.neon.tech/precious?sslmode=require`)
3. Push to `main` → auto-deploy. The function serves the API **and** the UI
   (`/` → `web/index.html`) from one origin.
4. **First request after a deploy is a cold start**: the embedding model
   (~90 MB) downloads to `/tmp` once per fresh instance (a few seconds).
   If the download fails, RAG degrades to a lexical fallback and the state is
   visible in `/api/health` → `embedder_state` and Admin → Settings.
5. Verify: open the site, check `/api/health` → `storage.kind` should be
   `postgres`, `persistent: true`, and `ok: true`.

### 2.3 Rollback

- **Vercel**: Deployments → find last good deployment → *Promote to Production*.
- **Mode A API**: `git revert <bad-commit>` + push; pull + restart on the server.
- Schema changes are additive; Postgres migrations are not required for
  current versions (idempotent `CREATE ... IF NOT EXISTS` on startup).

## 3. Monitoring

| Signal | Where | Check |
|---|---|---|
| Liveness | `GET /api/health` | Always HTTP 200; assert **`"ok": true`** in the body (not just the status code) |
| Storage | `/api/health` → `storage` | kind, persistent, path/host; ephemeral mode carries a `warning` field |
| Errors | Admin UI → Error logs | all 5xx/provider failures recorded with detail |
| Usage & cost | Admin UI → Analytics | tokens/messages/day; Groq 429s show as friendly user message |
| Provider health | Admin UI → Settings → Test key | one-click key verification |
| Vercel | Vercel dashboard | deploy status, function errors, Speed Insights, function duration |

## 4. Incident response

Sole operator (you). Escalation path: you → Groq status page → Vercel status
→ hosting provider → GitHub Issue with the error-log excerpt.

**Triage (first 10 minutes)**
1. `GET /api/health`:
   - `ok: false` + `error` → read it (DB connection? missing env var?).
   - `storage.warning` present → you're running ephemeral sqlite; data resets
     on instance recycle (expected in Mode B without Postgres).
   - `embedder_state: fallback` → model download blocked; RAG quality reduced.
2. Capture: Admin → Error logs, Vercel function logs (Deployments → request),
   `vercel logs --request-id <id>` with the CLI.
3. Contain:
   - Bad deploy → §2.3 rollback.
   - Postgres down/credentials → fix connection string; the provider
     auto-reconnects on the next request after a restart.
   - Groq rate limit → self-clears or switch model in Admin (no redeploy).
4. Recover → re-run smoke test → record in a GitHub Issue.

**Smoke test (after any deploy)**
```bash
curl -s https://<site>/api/health | python3 -m json.tool
# expect: "ok": true, storage.kind as configured
# then in the browser: log in → send a message → Knowledge search → Admin overview
```

## 5. Storage & persistence — what lives where

| Data | Mode A (sqlite on disk) | Mode B default (sqlite in /tmp) | Mode B + Postgres |
|---|---|---|---|
| Owner account & password hash | persistent | **lost on instance recycle** | persistent |
| Sessions (logins) | persistent | lost | persistent |
| Conversations & messages | persistent | lost | persistent |
| Knowledge docs (metadata) | persistent | lost | persistent |
| KB chunks + embeddings | persistent | lost | persistent (BYTEA) |
| Uploaded raw files | persistent | lost (chunks/embeddings already extracted — search still works if DB persists) | metadata persists; raw file is in /tmp (re-upload needed only to re-extract) |
| Memories / suggestions | persistent | lost | persistent |
| Feedback, error logs, chat events | persistent | lost | persistent |
| Instructions (versioned) | persistent | lost (re-seeded with defaults on boot) | persistent |
| Settings, tools registry | persistent | lost (re-seeded) | persistent |
| Eval cases & runs | persistent | lost | persistent |
| Embedding model (~90 MB) | cached on disk | re-downloaded to /tmp per cold instance | same as left column |

**Rule: never treat Mode B without Postgres as a real deployment — it is a
demonstration mode. The app tells you so in `/api/health` and Admin.**

## 6. Vercel serverless limits (design constraints, known & accepted)

- **Function duration**: default 10 s, max 60 s on Hobby (set via repo-root
  `vercel.json` → `maxDuration: 60`). Large document processing (hundreds of
  chunks) may approach the limit; keep documents modest or use Mode A.
- **Request body**: 4.5 MB max on serverless. The app allows 25 MB files in
  Mode A; on Vercel keep uploads under 4.5 MB.
- **/tmp size**: 512 MB (Hobby). Enough for the 90 MB model + sqlite + uploads.
- **No websockets / long-polling**: not used by this app.
- **Cold start**: model download + ONNX load adds a few seconds to the first
  RAG-touching request after a recycle.

## 7. Backups & data (Mode B + Postgres)

- Postgres provider (Neon/Supabase/Railway) — enable its native PITR/backup.
- In-app **Admin → Data export** (JSON, secrets masked) anytime; **Data &
  privacy → wipe** (typed confirmation) for deletion.
- Mode A: nightly `tar czf backup-$(date +%F).tar.gz data/` via cron.

## 8. Security checklist (re-verify quarterly)

- [ ] `GROQ_API_KEY` only in server/Vercel env — never in the repo, never in `web/`.
- [ ] `.env` git-ignored; `git ls-files | grep -i env` returns only `.env.example`.
- [ ] GitHub repo **private**; deploy key minimal (deploy only).
- [ ] HTTPS end-to-end (Vercel default; Postgres `sslmode=require`).
- [ ] `PA_CORS_ORIGINS` (Mode A) = your exact Vercel origin, never `*`.
- [ ] Session cookie httpOnly + SameSite=Lax; CSP + security headers present.
- [ ] Rate limits active (login 8/min; LLM 30/min/session; KB writes 10/min).
- [ ] Vercel: preview password protection + spend limit set.
- [ ] `PA_DATABASE_URL` is not present in any client-visible response
      (health shows host/db only, never credentials).
