# Precious AI — Vercel Production Checklist Review

Date: 2026-09-18 · Plan: **Hobby** · Architecture: **split** (Vercel static UI + FastAPI on a small server) · Domain: **none** (`*.vercel.app`)

Legend: ✅ handled in code (verified) · 🖱️ Vercel dashboard action (Hobby) · ➖ N/A for this stack · ⚠️ do this at deploy time

---

## 1. Operational excellence

| Item | Status | Detail |
|---|---|---|
| CI/CD — auto-deploy on push | ✅ + 🖱️ | Push-to-`main` → Vercel auto-deploy (UI). API: `git pull` + restart (RUNBOOK §2). Vercel imports the GitHub repo. |
| Preview deployments | ✅ + 🖱️ | Built in (per-branch `*.vercel.app`). Hobby allows previews; **enable Preview password protection** (Settings → Security) so previews aren't public. |
| Staging / promotion | ✅ | Test against preview URLs; promote via **Deployments → Promote to Production** (no code change). RUNBOOK §5. |
| Rollback procedure | ✅ | Written in RUNBOOK §5: Vercel promote-previous; API `git revert` + push. |
| Incident response plan | ✅ | RUNBOOK §4: triage → evidence → contain → recover → record. Sole-operator escalation path defined. |
| Log drains | ⚠️ → Pro | Not available on Hobby. Covered by in-app **Error logs** (Admin) — every 5xx/provider failure recorded server-side. Revisit on Pro. |
| Observability | ✅ | Speed Insights tag added (`/_speedinsights.js`) — auto-active on Vercel. In-app Analytics (tokens/messages/day) for LLM observability. |
| Uptime monitoring | 🖱️ | Add a free uptime check (UptimeRobot/etc.) against `GET /api/health` — 200 + `{"ok":true}`. |

## 2. Security

| Item | Status | Detail |
|---|---|---|
| Content-Security-Policy | ✅ | API responses (FastAPI middleware) **and** Vercel UI (`web/vercel.json`). `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`. |
| Security headers | ✅ | Both edges: `nosniff`, `X-Frame-Options DENY`, `Referrer-Policy`, `Permissions-Policy`; **HSTS** on HTTPS responses (API side). |
| Secrets | ✅ | `GROQ_API_KEY` only in server `.env` (git-ignored; verified absent from repo). UI contains no secrets. Masked in all API responses. |
| Session/cookies | ✅ | `pa_session` cookie: httpOnly, SameSite=Lax, Secure on HTTPS. |
| CORS (split hosting) | ✅ | `PA_CORS_ORIGINS` env → only your exact Vercel origin allowed; verified disallowed origins get no CORS headers. **Set it to your real Vercel URL at deploy time — never `*`.** |
| Rate limiting | ✅ | Login 8/min/IP; LLM endpoints 30/min/session (protects Groq free tier); KB writes 10/min. Verified 429 behavior. |
| Bot protection | 🖱️ | Vercel **Automatic Bot Protection** — on by default (Hobby). No action needed; custom bot rules = Pro. |
| WAF | 🖱️/➖ | Managed WAF rules: on by default. Custom WAF rules: **Pro+** — skip on Hobby. |
| Preview password protection | 🖱️ | Settings → Security → enable (Hobby). |
| SSO / SAML / SCIM / Audit logs | ➖ | Enterprise-only, not needed for a single-user app (your app has its own owner auth + error/feedback logs). |

## 3. Reliability

| Item | Status | Detail |
|---|---|---|
| Health check endpoint | ✅ | `GET /api/health` — status, model, key-configured, embedder, KB size. |
| Graceful error handling | ✅ | LLM errors → friendly user message + full detail in owner error log; 429 from Groq handled (verified live). |
| Backups / DR | ✅ (procedure) | RUNBOOK §6: nightly tar of `data/` + Admin → Data export (JSON). No automated backup yet — set the cron on your server. |
| Data durability | ⚠️ | SQLite needs a **persistent disk** — choose VPS (not a stateless container) or a disk-attached host (Render/Railway disk). |
| Function failover | ➖ | No serverless functions in this design (API is a single always-on process). |

## 4. Performance

| Item | Status | Detail |
|---|---|---|
| Caching | ✅ | `vercel.json`: `index.html` no-cache; `css/js` 1h (no content-hashing → conservative). Vercel CDN caches statics at the edge by default. |
| Image optimization (`next/image`) | ➖ | No `<img>` assets; single inline SVG favicon. |
| Font optimization (`next/font`) | ➖ | System font stack — zero font downloads (mobile-friendly by design). |
| Script optimization (`next/script`) | ➖ | 7 small local JS files, no CDN, no third-party scripts (except Vercel's own Speed Insights). No framework build step. |
| Payload size | ✅ | HTML ~3 KB, CSS 18 KB, JS ~110 KB total — loads instantly on mobile networks. |
| Speed Insights | ✅ | Tag added; appears in Vercel dashboard automatically. |
| ISR / on-demand revalidation | ➖ | Static SPA; nothing to revalidate. |

## 5. Cost optimization

| Item | Status | Detail |
|---|---|---|
| LLM cost | ✅ | Groq **free tier** only; local ONNX embeddings (free, no external calls); app-level rate limiter caps runaway usage; Analytics shows daily token counts; model switchable in Admin without redeploy. |
| Vercel cost | ✅ | Static site only — ~0 serverless spend; Hobby covers it (100 GB bandwidth/mo is far more than a personal UI uses). |
| Spend limit | 🖱️ | **Account → Billing → set spend limit** (recommend $0 cap while on Hobby) — one-click, prevents billing surprises. |
| Fluid compute / serverless regions | ➖ | No functions. |
| Server cost | ✅ | One small VPS (or free-tier Render/Railway instance) — cheapest option that gives persistent disk + HTTPS. |

---

## Deploy-time action list (only things a dashboard click or env var covers)

1. **Vercel**: New Project → import repo → **Root Directory `web`**, Framework *Other*, no build command.
2. **Vercel** → Settings → Security: enable **Preview password protection**.
3. **Vercel** → Account → Billing: set **spend limit**.
4. **API server** env: `GROQ_API_KEY=…`, `PA_CORS_ORIGINS=https://<your-project>.vercel.app`, install from `requirements.lock`, TLS via reverse proxy/host.
5. **`web/config.js`**: set `window.PA_API = "https://<api-host>"` → push (Vercel auto-deploys).
6. Add an uptime check for `https://<api-host>/api/health`.
7. Verify in browser devtools: CSP header present on UI + API; session cookie httpOnly.

Everything else on the official checklist is either already handled in the codebase
(commit `62b1334`, verified by the 86/86 live suite + targeted checks) or not
applicable to this stack.
