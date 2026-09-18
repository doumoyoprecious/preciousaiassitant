# Precious AI — Architecture & Extension Guide

## 1. Big picture

```
                ┌────────────────────────── Browser (mobile-first SPA, no CDN) ──────────────────────────┐
                │  Chat │ Knowledge │ Memory │ Learn │ Admin │  (auth screen on first run)               │
                └───────────────────────────────────────┬────────────────────────────────────────────────┘
                                                        │ HTTPS (same origin)
┌───────────────────────────────────────────────────────▼────────────────────────────────────────────────┐
│ FastAPI  (app/main.py)                                                                                  │
│  • exception handlers → user-safe error messages, details to error_logs                                 │
│  • auth: setup/login/whoami, httpOnly session cookies, require_user / require_owner                     │
│  • routers: chat, knowledge, memory, training, admin, eval, auth                                        │
└──────────────┬──────────────────────────────┬──────────────────────────────┬───────────────────────────┘
               │                              │                              │
        ┌──────▼───────┐              ┌───────▼────────┐             ┌───────▼────────┐
        │ agent/engine │              │ services/*     │             │ providers/*    │
        │ context → RAG│              │ knowledge      │             │ abstraction    │
        │ → memory →   │              │ memory         │             │ Groq / OpenAI /│
        │ tools → LLM  │              │ instructions   │             │ Anthropic /    │
        │ → persist    │              │ analytics      │             │ Gemini /       │
        └─────────────┘              │ evaluation     │             │ OpenRouter /   │
               │                      └───────┬────────┘             │ Ollama         │
        ┌──────▼──────────────────────────────▼────────┐             ──────┬─────────┘
        │ rag/  extract → chunk → embed (local ONNX,   │                    │
        │       free, keyless) → sqlite vector store   │                    │
        └──────────────────────┬───────────────────────┘                    │
                               │                                            │
                     ┌─────────▼────────────────────────────────────────────▼─────┐
                     │ SQLite (data/precious.db) + data/uploads + data/models      │
                     │ conversations, messages, documents, chunks, memories,       │
                     │ suggestions, feedback, instructions (versioned), settings, │
                     │ api_keys (server-side), error_logs, eval_cases/runs,       │
                     │ chat_events, tools_registry                                │
                     └────────────────────────────────────────────────────────────┘
```

## 2. Agent reasoning workflow (per user message)

1. **Understand intent** — the model does this implicitly; the engine prepares everything it might need.
2. **Conversation context** — last N messages (configurable, default 12) from SQLite.
3. **Knowledge retrieval (RAG)** — query embedded locally, cosine top-k (default 4) above a
   min-score (default 0.25). Empty or trivial queries skip retrieval. Retrieval events are logged
   (failed retrievals appear in Admin → Overview).
4. **Memory** — active long-term memories (owner-approved only) are injected with their kind.
5. **Tools** — if enabled and the provider supports function calling, registered built-in tools are
   offered; tool calls are executed server-side (all non-destructive) and the result fed back
   (max 4 tool rounds). Steps are surfaced to the user as short activity lines.
6. **Generate** — via the configured provider.
7. **Self-check / grounding** — enforced through the system prompt: cite retrieved sources with
   [S#] tags, state "not in my knowledge base" when retrieval has nothing and the model is unsure,
   never fabricate. The UI only ever shows sources that were actually retrieved (no fake citations).
8. **Persist + analytics** — message with sources/steps/tokens, chat event, optional memory
   *suggestion* (never auto-stored — the user approves).

Hidden chain-of-thought is never exposed; only concise, factual activity lines ("Retrieved 3
relevant passages…", "Using tool: calculator.") are shown.

## 3. RAG pipeline

- **Extract** (`rag/extract.py`): PDF (pypdf, per-page), DOCX (python-docx incl. tables→markdown),
  TXT/MD (raw, markdown headings kept), CSV (→ markdown table, 400-row cap), URL (requests +
  BeautifulSoup, scripts/nav stripped). Clear, specific errors for unsupported/empty/password-protected files.
- **Chunk** (`rag/chunk.py`): ~700-char paragraphs (configurable), ~100 overlap, markdown headings
  tracked as *section*, PDF pages tracked as *page* (shown in citations).
- **Embed** (`rag/embed.py`): `sentence-transformers/all-MiniLM-L6-v2` (384-d) via fastembed/ONNX,
  cached in `data/models` (persistent). **Local and free.** Deterministic hashed bag-of-words
  fallback keeps search working if the model can't load (state is reported honestly in Admin).
- **Store** (`rag/store.py`): embeddings as float32 BLOBs in SQLite; numpy cosine search;
  per-category filtering; document replace/delete keeps the index consistent.
- **Citations**: each retrieved chunk is numbered `[S#]` in the prompt with its document, page and
  section; the model is instructed to cite tags it uses; the UI renders the actual retrieved
  sources as chips under the answer (name + page + section + relevance). If nothing was retrieved,
  nothing is cited.

## 4. Memory model

- **Short-term:** conversation history (SQLite), sliding window per `history_limit`.
- **Long-term:** `memories` table. Rows are created **only** via: explicit add (Memory view),
  Training Mode teaching, or **approval** of a suggestion. Chat heuristics detect
  "remember that / always keep / from now on / whenever I…" and create a *pending suggestion* —
  shown as a chip with Save/Dismiss — that is discarded if not approved.
- Memories are injected into the system prompt (kind-tagged) on every turn, capped at 15 items.
- Full CRUD + search + clear-all with typed confirmation.

## 5. Instructions (prompt configuration) with versioning

`instructions` table = immutable versioned rows; `active_instruction_version` in settings points at
the live one. Admin → Instructions edits personality, tone, length, domain, formats, business,
safety, rules[], restrictions[], terminology[] → saves a new version, activates it, and any older
version can be re-activated (revert) at any time. Changes require no code edits or restart.

## 6. Provider abstraction (model flexibility)

`providers/base.py` defines the contract:

```python
class LLMProvider:
    def chat(self, system, messages, tools, temperature, max_tokens, api_key, model) -> LLMResult
    def supports_tools(self) -> bool
    def health(self, api_key) -> (ok, message)
    def list_models(self, api_key) -> [str]
```

Implementations: `OpenAICompat` (Groq, OpenAI, OpenRouter, Ollama — one class, base URL differs),
`Anthropic`, `Gemini`. All normalize to one internal message format (including tool calls/results).
`registry.get_provider(name)` + `resolve_api_key(provider)` (DB key → env var) are the only two
functions the engine uses — adding a provider = one small class.

Error mapping is per-provider (401→"key rejected", 429→"rate limited", 5xx→"try again", network)
and always user-safe.

## 7. Tool framework

- Registry in DB (`tools_registry`): name, description, JSON-schema params, enabled flag, built_in.
- Handlers in `agent/tools.py` (`HANDLERS` dict). Only tools with handlers can be exposed to the
  model; planned rows are inert and cannot be enabled (the API rejects it).
- **Safety rule:** tools are non-destructive by design. Destructive operations (delete, send, wipe)
  are explicit UI actions with confirmations, never model-triggered. A `confirm_required` convention
  is reserved for future interactive tools.
- Adding a tool: write a handler + insert a registry row (or seed in `config.TOOL_SEEDS`).

## 8. Security model

- First-run **setup** creates the single owner (PBKDF2-SHA256, 200k iterations, per-user salt).
- Sessions: `secrets.token_urlsafe(32)` → DB with 7-day expiry; httpOnly + SameSite=Lax cookie
  (+Secure on HTTPS). Login rate-limited (8/min/IP).
- Dependencies: `require_user` (all app endpoints) and `require_owner` (all admin/management
  endpoints). There is no anonymous data access.
- Secrets: API keys live in `api_keys` (DB) or `.env` (server env). Responses return masked keys
  only; data export excludes `sessions`, `owner` and masks `api_keys`. System prompt/instructions
  are never returned to the client.
- Errors: `LLMError` and generic exceptions are converted to friendly JSON (`{"error": ...}`);
  details (with paths) go to `error_logs` — viewable only by the owner.

## 9. Phase status (honest)

| Phase | Name | Status | Notes |
|---|---|---|---|
| 1 | Core Agent | ✅ implemented & tested | chat, provider connection, instructions, context, mobile UI, error handling |
| 2 | Knowledge / RAG | ✅ implemented & tested | uploads, processing, local embeddings, retrieval, citations, categories, flags |
| 3 | Memory | ✅ implemented & tested | short-term context + approval-gated long-term memory, full management |
| 4 | Training Mode | ✅ implemented & tested | structured teaching, training conversations, feedback→FAQ corrections |
| 5 | Admin | ✅ implemented & tested | auth, knowledge & memory management, versioned instructions, feedback, evaluation, analytics, error logs, data controls |
| 6 | Tools | ✅ implemented (core set) | framework + calculator, date/time, KB search, doc list; more tools via registry |
| 7 | Advanced Automation | 🚧 **planned, architecture-ready** | web search, email, calendar, document generation (files), DB queries, automation workflows, voice in/out, WhatsApp/Telegram, scheduled tasks, multi-agent, CRM, website chatbot, multi-user accounts, subscriptions |

Planned Phase 7 capabilities are visible in Admin → Modules and Tools (marked *planned*) and
**cannot be enabled** — nothing is faked. The seams they plug into already exist: tool registry,
provider abstraction, chat events log, settings, categories, and the per-service structure.

## 10. Extension guide (how to add X)

- **New model provider:** subclass `LLMProvider`, add base URL/catalog entry in `config.py`,
  register in `providers/registry.py`. Done.
- **New tool:** handler function in `agent/tools.py` + `tools_registry` row.
- **New file format:** extend `rag/extract.py` (`extract_file`) + `SUPPORTED_EXTS`.
- **New RAG backend (e.g. API embeddings, pgvector):** replace `rag/embed.py` / `rag/store.py`
  implementations only — the engine and services don't change.
- **Streaming responses:** wrap `provider.chat` in an SSE variant and add a `/stream` route;
  the UI already has the pending-message slot to fill.
- **Multi-user:** add `user_id` to conversations/knowledge/memories (single-user today by design),
  enforce in `require_user`; owner role already exists for the permission check.
- **Voice:** WebAudio recording in the composer → STT tool; TTS responses via a `voice_response`
  tool. The tool slots are already registered as planned.

## 11. Testing

`tests/test_workflows.py` — 86 end-to-end checks against the live server covering: setup/login,
authorization (401s), conversations CRUD/search, graceful no-key & auth-error handling with retry,
file upload → chunking → **relevance search**, unsupported-file rejection, manual knowledge,
authoritative/outdated flags, CSV indexing, replace/delete, memory add/search/edit +
suggestion approve/reject + clear, training (memory & KB targets), feedback with corrections,
evaluation cases/runs/flags, instruction versioning & revert, settings validation, API key
masking, tools enable/disable (planned rejected), analytics, error logs, modules, export
(secrets excluded), typed-confirmation wipes, and static asset serving.

```bash
python3 tests/test_workflows.py [base_url]
```
