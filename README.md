# ✦ Precious AI

A real, functional **personal AI agent** — not a static chatbot. You talk to it, teach it, feed it
documents, correct it, test it, and it gets better over time. Built to be continuously extended.

- **Backend:** FastAPI + SQLite (single self-contained app, no external services required)
- **Frontend:** Mobile-first single-page app (works on iPhone, Android and desktop)
- **RAG:** Local, free embeddings (all-MiniLM-L6-v2 via ONNX — no API key, no cost) + vector search
- **Model:** Swappable via a provider abstraction — **Groq** (free tier) preconfigured, with
  OpenAI, Anthropic, Google Gemini, OpenRouter and local Ollama supported from day one
- **Memory:** Short-term (conversation) + long-term (only what you explicitly save or approve)

## Quick start

```bash
cd precious-ai
bash run.sh            # installs deps if missing, starts on port 8000
```

1. Open the app in your browser.
2. **First run:** create your owner account (username + password, min 8 chars).
3. Chat shows a friendly "No API key configured" message until a key is available.
   Two supported, equally secure ways — **neither ever touches the frontend**:
   - **Environment variable (recommended):** create a `.env` file (see `.env.example`)
     with `GROQ_API_KEY=...`, then restart the server. Verified working end-to-end.
   - **Admin UI:** Admin → API Keys → Groq → paste → *Test* → *Save* (stored server-side,
     masked in every response). A DB-stored key takes precedence over the env var.
4. Start teaching it: upload documents in **Knowledge**, add **Memory**, use **Learn**
   (Training Mode), and tune behavior in **Admin → Instructions** (versioned, reversible).

## Syncing to GitHub

The project is a self-contained Python repo — no architectural changes needed to sync:

```bash
cd precious-ai
git init
git add -A && git commit -m "Precious AI v1.0"
git remote add origin git@github.com:<you>/precious-ai.git
git push -u origin main
```

- `.gitignore` already excludes everything sensitive and regenerable: `.env`, the SQLite
  database (`data/` — it contains the owner password and any stored keys), uploaded files,
  and the ~90 MB embedding-model cache (re-downloaded automatically on first use).
- On a fresh clone: `bash run.sh` recreates `data/`, the schema, and the local embedding
  model automatically. Nothing else to do.


## What's implemented (tested end-to-end — 86/86 workflow checks passing)

| Area | Features |
|---|---|
| **Chat** | Conversations (new/rename/clear/delete/search), context across messages, file upload in chat, copy, regenerate, 👍//⚠ feedback with corrections, loading indicator, friendly error cards with retry, mobile-responsive |
| **RAG / Knowledge** | Upload PDF, DOCX, TXT, MD, CSV (≤25 MB); add websites; add notes/FAQs manually; categories (Personal, Projects, Education, Career, AI, Data Analytics, Blockchain/Web3, Business, Technical Documentation, FAQs, General Knowledge); authoritative & outdated flags; replace; delete; KB search with relevance scores; **source citations (document + page/section) on answers** |
| **Memory** | Long-term memory stored **only** when you save it or approve a suggestion; add/view/edit/delete/search/clear-all; suggestion chips in chat ("remember that …") with approve/dismiss |
| **Training Mode** | Teach facts, preferences, formats, terminology, workflows, business rules → straight into memory or knowledge base; training conversations; corrections from feedback → FAQ |
| **Admin (owner-only)** | Analytics (activity, top questions, failed retrievals, knowledge gaps, helpful rate), feedback review, versioned agent instructions (personality/tone/length/rules/restrictions/terminology/formats/safety/business) with revert, settings (provider, model, temperature, RAG top-k, min-score, chunk size, history length), API keys (masked, test-connection), tools management, evaluation/testing, error logs, data export (secrets excluded), scoped data wipe with typed confirmation, modules/roadmap status |
| **Evaluation** | Test cases (question, expected behavior, required info, notes); run single/all; auto-scoring against required info; flags for possible unsupported claims, missing info, retrieval mismatch; run history |
| **Tools** | Pluggable framework with Admin enable/disable: **calculator**, **date & time** (Africa/Lagos default), **knowledge base search**, **document list**. The agent states when it uses a tool. Planned tools (web search, email, calendar, DB, voice, WhatsApp/Telegram, …) are visible but honestly marked *planned* and cannot be enabled |
| **Security** | Owner setup + login (PBKDF2, 200k iterations), httpOnly session cookies, rate-limited login, every API call authorized, owner-only admin surface, secrets never exposed (masked in API, excluded from export), raw errors never shown to users |
| **Model flexibility** | Provider abstraction (`app/providers/`): Groq, OpenAI, Anthropic, Gemini, OpenRouter, Ollama — change provider/model in Admin → Settings without code changes |
| **Cost control** | Free-tier provider by default (Groq), local free embeddings, small default context (12 messages), token usage logged per response, no paid services in the loop |

## Project layout

```
precious-ai/
├── app/
│   ├── main.py              # FastAPI app, error handling, static serving
│   ├── config.py            # paths, defaults, provider/model catalogs
│   ├── db.py                # SQLite schema + access helpers
│   ├── auth.py              # setup/login/sessions/authorization
│   ├── providers/           # LLM abstraction: base, openai_compat (groq/openai/openrouter/ollama), anthropic, gemini, registry
│   ├── rag/                 # extract (pdf/docx/csv/md/url), chunk, embed (local ONNX + fallback), store (sqlite vectors)
│   ├── agent/               # engine (context→RAG→tools→response), tools framework
│   ├── services/            # knowledge, memory, instructions, analytics, evaluation
│   └── routers/             # REST API: auth, chat, knowledge, memory, training, admin, eval
├── web/                     # mobile-first SPA (no build step, no CDN)
├── tests/test_workflows.py  # end-to-end workflow suite (86 checks)
├── data/                    # SQLite DB, uploaded files, local embedding model (persistent)
├── run.sh                   # boot script
└── .env.example             # optional server-side environment config
```

## Everyday workflow

1. **Feed it:** Knowledge → Upload / Add text / Add website.
2. **Teach it:** Learn → teach preferences, terms, workflows; or say "remember that …" in chat
   and approve the suggestion chip.
3. **Check it:** Admin → Evaluation — add test cases, run them, review flags.
4. **Fix it:** mark wrong answers with the correct answer in chat → Admin → Feedback →
   *Save correction as FAQ* → the gap is closed for good.
5. **Tune it:** Admin → Instructions (personality, tone, rules) — every change versioned & reversible.
6. **Switch models anytime:** Admin → Settings (provider + model) and API Keys.

## Security notes

- API keys: stored in the server-side database (masked everywhere) or in `.env` — **never** in
  frontend code or API responses. Data export masks them.
- Sessions: httpOnly, SameSite=Lax cookies, 7-day expiry; login rate-limited.
- Authorization: every endpoint requires an authenticated owner; admin surface checks the owner role.
- Errors: users see friendly messages; technical details go to Admin → Error logs only.

## Limitations (honest status)

- Legacy `.doc` and scanned-image PDFs (OCR) are not supported — clear errors are returned.
- Single owner account (multi-user accounts are a planned module).
- Streaming responses are not implemented (responses arrive whole, with a live "thinking" indicator).
- Phase 7 tools (web search, email, calendar, voice, WhatsApp/Telegram, scheduled tasks, multi-agent)
  are **architecture-ready but not implemented** — they are clearly marked *planned* in Admin → Modules
  and cannot be enabled.

See `ARCHITECTURE.md` for the full design, phase status and extension guide.
