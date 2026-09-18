"""Admin/owner API: settings, keys, instructions, tools, feedback, errors, data."""
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import auth, config, db
from ..providers import registry
from ..providers.base import LLMError
from ..rag import embedder
from ..services import analytics, instructions, knowledge as kb

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _mask(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "****"
    return key[:4] + "…" + key[-4:]


# ---------- overview / analytics ----------

@router.get("/overview")
def overview(user=Depends(auth.require_owner)):
    return analytics.overview()


# ---------- settings ----------

@router.get("/settings")
def get_settings(user=Depends(auth.require_owner)):
    return db.all_settings()


class SettingsIn(BaseModel):
    values: dict


SETTABLE = {"provider", "model", "temperature", "max_tokens", "rag_top_k",
            "rag_min_score", "chunk_size", "history_limit", "memory_enabled",
            "tools_enabled", "timezone"}


@router.post("/settings")
def set_settings(body: SettingsIn, user=Depends(auth.require_owner)):
    updated = []
    for k, v in body.values.items():
        if k not in SETTABLE:
            continue
        v = str(v)
        if k in ("temperature",):
            try:
                v = str(min(max(float(v), 0.0), 1.5))
            except ValueError:
                raise HTTPException(400, "Temperature must be a number between 0 and 1.5.")
        if k in ("max_tokens", "rag_top_k", "chunk_size", "history_limit"):
            try:
                v = str(int(float(v)))
            except ValueError:
                raise HTTPException(400, f"{k} must be a number.")
        if k in ("memory_enabled", "tools_enabled"):
            v = "true" if str(v).lower() in ("true", "1", "yes") else "false"
        if k == "provider" and v not in config.PROVIDERS:
            raise HTTPException(400, "Unknown provider.")
        db.set_setting(k, v)
        updated.append(k)
    return {"updated": updated, "settings": db.all_settings()}


# ---------- API keys (server-side only, never returned in full) ----------

@router.get("/keys")
def list_keys(user=Depends(auth.require_owner)):
    rows = {r["provider"]: r["key"] for r in db.query("SELECT provider, key FROM api_keys")}
    env = {p: bool(__import__("os").environ.get(config.ENV_KEY_NAMES[p], "")) for p in config.PROVIDERS}
    out = []
    for p in config.PROVIDERS:
        stored = rows.get(p, "")
        out.append({"provider": p, "display": registry.provider_display(p),
                    "set": bool(stored), "from_env": env.get(p, False),
                    "masked": _mask(stored) or ("env var" if env.get(p) else "")})
    return out


class KeyIn(BaseModel):
    provider: str
    key: str = ""


@router.post("/keys")
def set_key(body: KeyIn, user=Depends(auth.require_owner)):
    if body.provider not in config.PROVIDERS:
        raise HTTPException(400, "Unknown provider.")
    key = body.key.strip()
    if not key:
        db.execute("DELETE FROM api_keys WHERE provider=?", (body.provider,))
        return {"ok": True, "removed": True}
    if len(key) < 8:
        raise HTTPException(400, "That key looks too short to be valid.")
    db.execute("INSERT INTO api_keys(provider,key,updated_at) VALUES(?,?,?) "
               "ON CONFLICT(provider) DO UPDATE SET key=excluded.key, updated_at=excluded.updated_at",
               (body.provider, key, db.now()))
    return {"ok": True, "masked": _mask(key)}


@router.delete("/keys/{provider}")
def delete_key(provider: str, user=Depends(auth.require_owner)):
    db.execute("DELETE FROM api_keys WHERE provider=?", (provider,))
    return {"ok": True}


@router.post("/keys/{provider}/test")
def test_key(provider: str, user=Depends(auth.require_owner)):
    if provider not in config.PROVIDERS:
        raise HTTPException(400, "Unknown provider.")
    key = registry.resolve_api_key(provider)
    if not key:
        return {"ok": False, "message": "No API key configured for this provider yet."}
    try:
        provider_obj = registry.get_provider(provider)
    except LLMError as e:
        return {"ok": False, "message": e.message}
    ok, msg = provider_obj.health(key)
    return {"ok": ok, "message": msg}


# ---------- models ----------

@router.get("/models")
def models(provider: str = None, user=Depends(auth.require_owner)):
    provider = provider or db.get_setting("provider", "groq")
    catalog = config.MODEL_CATALOG.get(provider, [])
    live = []
    key = registry.resolve_api_key(provider)
    try:
        provider_obj = registry.get_provider(provider)
        live = provider_obj.list_models(key)
    except LLMError:
        pass
    merged = list(dict.fromkeys(catalog + live))
    return {"provider": provider, "catalog": merged, "live_count": len(live)}


# ---------- instructions (versioned) ----------

@router.get("/instructions")
def instructions_list(user=Depends(auth.require_owner)):
    return instructions.history()


class InstructionsIn(BaseModel):
    fields: dict
    note: str = ""


@router.post("/instructions")
def instructions_save(body: InstructionsIn, user=Depends(auth.require_owner)):
    try:
        return instructions.save(body.fields, body.note)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Could not save instructions: {e}")


@router.post("/instructions/{version}/activate")
def instructions_activate(version: int, user=Depends(auth.require_owner)):
    try:
        return instructions.activate(version)
    except LLMError as e:
        raise HTTPException(400, e.message)


# ---------- tools ----------

@router.get("/tools")
def tools_list(user=Depends(auth.require_owner)):
    return db.query("SELECT * FROM tools_registry ORDER BY built_in DESC, name")


class ToolIn(BaseModel):
    name: str
    enabled: bool


@router.post("/tools")
def tool_set(body: ToolIn, user=Depends(auth.require_owner)):
    row = db.query_one("SELECT * FROM tools_registry WHERE name=?", (body.name,))
    if not row:
        raise HTTPException(404, "Unknown tool.")
    if not row["built_in"]:
        raise HTTPException(400, "This tool is planned and not implemented yet.")
    db.execute("UPDATE tools_registry SET enabled=? WHERE name=?",
               (1 if body.enabled else 0, body.name))
    return {"ok": True}


# ---------- feedback review ----------

@router.get("/feedback")
def feedback_list(filter: str = "all", user=Depends(auth.require_owner)):
    q = ("SELECT f.*, am.content AS answer, u.content AS question, c.title AS conv_title "
         "FROM feedback f "
         "JOIN messages am ON am.id=f.message_id "
         "LEFT JOIN messages u ON u.conv_id=am.conv_id AND u.role='user' AND u.created_at<=am.created_at "
         "LEFT JOIN conversations c ON c.id=am.conv_id ")
    args = ()
    if filter == "down":
        q += "WHERE f.rating='down' "
    elif filter == "issue":
        q += "WHERE f.rating='issue' "
    q += "ORDER BY f.created_at DESC LIMIT 100"
    rows = db.query(q, args)
    for r in rows:
        r["answer"] = (r.get("answer") or "")[:400]
        r["question"] = (r.get("question") or "")[:400]
    return rows


class SaveCorrectionIn(BaseModel):
    title: str = ""
    category: str = "FAQs"


@router.post("/feedback/{fid}/save_as_knowledge")
def save_correction(fid: str, body: SaveCorrectionIn, user=Depends(auth.require_owner)):
    row = db.query_one("SELECT * FROM feedback WHERE id=?", (fid,))
    if not row:
        raise HTTPException(404, "Feedback not found.")
    content = (row.get("corrected_answer") or row.get("note") or "").strip()
    if not content:
        raise HTTPException(400, "This feedback has no correction text to save.")
    try:
        doc = kb.add_manual(body.title or (row.get("note") or "Corrected answer")[:60],
                            content, body.category, kind="faq")
    except LLMError as e:
        raise HTTPException(400, e.message)
    return {"ok": True, "document": doc["name"]}


# ---------- error logs ----------

@router.get("/errors")
def errors(limit: int = 100, user=Depends(auth.require_owner)):
    if limit > 500:
        limit = 500
    return db.query("SELECT * FROM error_logs ORDER BY created_at DESC LIMIT ?", (limit,))


@router.post("/errors/clear")
def errors_clear(user=Depends(auth.require_owner)):
    db.execute("DELETE FROM error_logs")
    return {"ok": True}


# ---------- modules / roadmap status ----------

@router.get("/modules")
def modules(user=Depends(auth.require_owner)):
    kb_stats = kb.stats()
    return {
        "embedder": embedder.backend(),
        "kb": kb_stats,
        "phases": [
            {"phase": 1, "name": "Core Agent", "status": "implemented",
             "features": ["Chat interface", "LLM provider abstraction (Groq/OpenAI/Anthropic/Gemini/Ollama/OpenRouter)",
                          "System instructions + versioning", "Conversation context",
                          "Mobile-first UI", "Error handling"]},
            {"phase": 2, "name": "Knowledge / RAG", "status": "implemented",
             "features": ["Document upload (PDF/TXT/MD/DOCX/CSV)", "Website content",
                          "Local free embeddings (no API cost)", "Vector search",
                          "Source citations", "Categories, authoritative/outdated flags"]},
            {"phase": 3, "name": "Memory", "status": "implemented",
             "features": ["Short-term (conversation context)", "Long-term (explicitly approved only)",
                          "Suggestion → approve/reject flow", "Memory CRUD + search + clear"]},
            {"phase": 4, "name": "Training Mode", "status": "implemented",
             "features": ["Teach facts/preferences/formats/terminology/workflows",
                          "Training conversations", "Corrections from feedback → knowledge base"]},
            {"phase": 5, "name": "Admin", "status": "implemented",
             "features": ["Owner authentication", "Knowledge management", "Memory management",
                          "Versioned agent instructions", "Feedback review", "Evaluation/testing",
                          "Analytics", "Error logs", "Data export/wipe"]},
            {"phase": 6, "name": "Tools", "status": "implemented",
             "features": ["Tool framework with Admin enable/disable",
                          "Calculator", "Date & time", "Knowledge base search", "Document list"]},
            {"phase": 7, "name": "Advanced Automation", "status": "planned",
             "features": ["Web search", "Email", "Calendar", "Document generation (files)",
                          "Database queries", "Voice input/output", "WhatsApp/Telegram",
                          "Scheduled tasks", "Multi-agent workflows", "CRM",
                          "Multiple user accounts", "Website chatbot"]},
        ],
    }


# ---------- data management ----------

@router.get("/data/export")
def data_export(user=Depends(auth.require_owner)):
    """Export user data. Secrets (API keys, session tokens, password hashes) are never exported."""
    tables = {t["name"] for t in db.query("SELECT name FROM sqlite_master WHERE type='table'")}
    export = {"app": "precious-ai", "exported_at": int(time.time()), "data": {}}
    for t in sorted(tables):
        if t.startswith("sqlite_"):
            continue
        if t in ("sessions", "owner", "chunks"):
            # sessions/owner = secrets; chunks = binary embeddings (regenerated from documents)
            continue
        if t == "api_keys":
            export["data"][t] = [{"provider": r["provider"], "key": _mask(r["key"])}
                                 for r in db.query("SELECT * FROM api_keys")]
            continue
        export["data"][t] = db.query(f"SELECT * FROM {t}")
    export["data"]["chunks_note"] = ("chunk embeddings excluded (binary); they are regenerated "
                                     "automatically when documents are re-indexed")
    return export


class WipeIn(BaseModel):
    scope: str  # conversations | memories | knowledge | feedback | events | all
    confirm: str = ""


@router.post("/data/wipe")
def data_wipe(body: WipeIn, user=Depends(auth.require_owner)):
    if body.confirm != "YES":
        raise HTTPException(400, "Type YES in the confirm field to proceed.")
    scope = body.scope
    if scope not in ("conversations", "memories", "knowledge", "feedback", "events", "all"):
        raise HTTPException(400, "Unknown wipe scope.")
    if scope in ("knowledge", "all"):
        for d in db.query("SELECT id FROM documents"):
            try:
                kb.delete(d["id"])
            except LLMError:
                pass
    if scope in ("conversations", "all"):
        db.execute("DELETE FROM messages")
        db.execute("DELETE FROM conversations")
    if scope in ("memories", "all"):
        db.execute("DELETE FROM memories")
        db.execute("DELETE FROM suggestions")
    if scope in ("feedback", "all"):
        db.execute("DELETE FROM feedback")
        db.execute("DELETE FROM eval_runs")
    if scope in ("events", "all"):
        db.execute("DELETE FROM chat_events")
        db.execute("DELETE FROM error_logs")
    db.log_event("data_wipe", detail={"scope": scope})
    return {"ok": True, "scope": scope}
