# Precious AI — Runbook

Operational reference for deploying, monitoring, and recovering the system.
Last updated: 2026-09-18.

## 1. Architecture (current)

```
┌─────────────────────┐          ┌──────────────────────────────┐
│  Vercel (static UI) │  HTTPS   │  API server (small VPS)      │
│  web/ + vercel.json │ ───────▶ │  FastAPI (app/) + uvicorn    │
│  *.vercel.app       │  REST    │  SQLite (data/precious.db)   │
│  window.PA_API      │          │  → Groq API (GROQ_API_KEY)   │
└─────────────────────┘          └──────────────────────────────┘
```

- **UI**: static SPA served by Vercel. No build step; root directory = `web/`.
- **API**: FastAPI + SQLite on a small always-on server (VPS / Render / Railway).
  Requires **persistent disk** (SQLite + uploaded documents live on disk).
- **Config glue**: `web/config.js` (`window.PA_API`) and the API env var
  `PA_CORS_ORIGINS=https://<your-vercel-domain>` must match each other.

### Environment variables (API server)

| Variable | Required | Meaning |
|---|---|---|
| `GROQ_API_KEY` | yes | LLM provider key (server-side only) |
| `PA_CORS_ORIGINS` | yes for split hosting | Comma-separated exact origins the UI may call, e.g. `https://precious-ai.vercel.app` |
| `PA_DATA_DIR` | no | Override for the data directory (default `./data`) |

## 2. Deployment

### 2.1 UI → Vercel (Hobby)

1. Vercel → New Project → import `doumoyoprecious/preciousaiassitant`.
2. **Root Directory: `web`** · Framework: *Other* (static) · Build command: *(none)*.
3. Every push to `main` auto-deploys to production (`https://<project>.vercel.app`).
4. Before the first production push, set `window.PA_API` in `web/config.js`
   to the API server's public URL.
5. Preview deployments (Hobby: up to 100/month on Hobby — verify your plan):
   each PR/branch gets a unique `*.vercel.app` URL. Use them to test the UI
   against the staging or production API by temporarily pointing
   `window.PA_API` at the staging API.

### 2.2 API → server

```bash
git pull                          # on the API server
pip install -r requirements.lock  # first run / dependency changes
systemctl restart precious-ai     # or: ./run.sh (dev), uvicorn app.main:app --host 0.0.0.0 --port 8000
curl -s localhost:8000/api/health
```

Keep the server behind a reverse proxy (Caddy/nginx) for TLS, or use a host
that provides it (Render/Railway) — the UI's CSP and cookies assume HTTPS.

## 3. Monitoring

| Signal | Where | Check |
|---|---|---|
| Liveness | `GET /api/health` | 200 + `{"status":"ok"}`; include in a uptime check (e.g. UptimeRobot free) |
| Errors | Admin UI → **Error logs** | All 5xx/provider failures are recorded server-side with detail |
| Usage & cost | Admin UI → **Analytics** | Tokens/messages/day; watch for Groq rate limits (HTTP 429 → user sees a friendly message, nothing is lost) |
| Provider health | Admin UI → **Settings → Test key** | One-click "Test" button verifies the key works |
| Vercel | Vercel dashboard | Deploy status, request errors, Speed Insights (auto) |

**No Log Drains on Hobby** — the in-app error log + analytics is the
observability layer. If you upgrade to Pro, add a Log Drain to your provider.

## 4. Incident response

**Roles**: owner = you (sole operator). Escalation path:
you → provider status page (Groq) → your VPS/hosting provider → open an issue
in the repo's GitHub Issues with the error-log excerpt.

### Triage (first 10 minutes)

1. **Identify scope**: UI only? API only? LLM only?
   - UI broken but API healthy → Vercel deploy issue → §5.1 rollback.
   - API healthy, LLM failing → check Groq status + Admin → Settings → Test key.
   - API down → VPS/hosting: is the process alive? disk full? OOM?
2. **Capture evidence**: Admin → Error logs (export), `curl /api/health`,
   Vercel deploy page, server `journalctl -u precious-ai --since "10 min ago"`.
3. **Contain**:
   - LLM rate limits (429) → self-clears; no action, or temporarily switch
     model to a cheaper/less-loaded one in Admin → Settings (no redeploy needed).
   - Bad deploy → roll back (§5).
   - Server resource exhaustion → restart service; check `data/` disk usage.
4. **Recover**: apply fix, verify with the smoke test below, note resolution.
5. **Communicate** (single-user system: this is a note to yourself):
   record the incident + resolution as a GitHub Issue on the repo so the
   history is searchable.

### Smoke test (run after any deploy or recovery)

```bash
# 1. API alive
curl -s https://<api-host>/api/health

# 2. Browser: open the UI, log in
#    - send a chat message → answer arrives
#    - Knowledge → search works
#    - Admin → Analytics shows the new activity
```

## 5. Rollback

### 5.1 UI (Vercel)

- Dashboard → project → **Deployments** → find the last good deployment →
  **"Promote to Production"**. Takes effect within a minute. No code changes.

### 5.2 API

```bash
# Option A: revert the specific commit
git revert <bad-commit>
git push        # then pull + restart on the server
# Option B: checkout the last good commit directly
git checkout <good-commit>
./run.sh        # or systemctl restart precious-ai
```

Data lives in SQLite on disk and is **not** affected by code rollbacks.
Schema changes are additive (see `app/db.py`); if a reverted migration drops
columns, export via Admin → **Data export** first.

## 6. Backups & data

- **Primary**: `data/` directory on the API server (SQLite + document store).
- **Backup cadence** (free-tier options):
  - Nightly `tar czf backup-$(date +%F).tar.gz data/` via cron + copy to an
    external bucket (Backblaze B1 free tier, or just a local/second machine).
  - Admin UI → **Data export** (JSON) on demand for full logical backup.
- **Deletion**: Admin → **Data & privacy** → wipe (with typed confirmation)
  implements the privacy controls; it deletes memories/conversations, keeps
  the owner account.

## 7. Security checklist (re-verify quarterly)

- [ ] `GROQ_API_KEY` exists **only** in the API server env (never in the repo,
      never in `web/`).
- [ ] `.env` is git-ignored; `git ls-files | grep -i env` returns nothing.
- [ ] GitHub repo is **private**; deploy keys are minimal (deploy, not owner).
- [ ] UI reachable only via HTTPS (Vercel default) with the CSP header present
      (check via browser devtools → Network).
- [ ] `PA_CORS_ORIGINS` lists only your Vercel domain (never `*`).
- [ ] Session cookie: httpOnly + SameSite=Lax (set by the API, verify in devtools).
- [ ] Rate limits active (login: 8/min; LLM: 30/min/session; KB writes: 10/min).
- [ ] Vercel **Preview password protection** enabled (Hobby) so previews
      aren't public; Vercel **spend limit** set in Account → Billing.

## 8. When you add a domain (future)

1. Buy the domain (or use your existing one).
2. Vercel: project → Settings → Domains → add `app.yourdomain.com`; point the
   DNS CNAME at `cname.vercel-dns.com` (Vercel provisions TLS automatically).
3. API server: point `api.yourdomain.com` (A/ALIAS record) at the server;
   configure the reverse proxy for that hostname (Caddy does TLS automatically).
4. Update: `window.PA_API` in `web/config.js` → `https://api.yourdomain.com`;
   `PA_CORS_ORIGINS` → `https://app.yourdomain.com`; push.
5. Optionally tighten the CSP `connect-src` in `web/vercel.json` to just
   `https://api.yourdomain.com` instead of `https:`.

## 9. Cost guardrails (free-tier aware)

- Groq free tier: ~30 req/min, 14,400 req/day — the app-level rate limiter
  keeps a stuck client from burning it; Analytics shows daily token counts.
- Vercel Hobby: 100 GB bandwidth/month, 100 preview deployments/month,
  6 concurrent builds — plenty for a single-user static UI.
- Set **Account → Billing → Spend limit** to $0 (or a small cap) so a
  plan upgrade surprise can't happen.
- If Groq free tier becomes a bottleneck, the provider abstraction
  (`app/providers/`) accepts any OpenAI-compatible endpoint — no code change
  beyond Admin → Settings.
