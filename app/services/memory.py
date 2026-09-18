"""Long-term memory (explicitly approved only) + pending suggestions."""
import re

from .. import config, db
from ..providers.base import LLMError


def add(content: str, kind: str = "fact", category: str = "General", source: str = "manual") -> dict:
    content = (content or "").strip()
    if not content:
        raise LLMError("Memory content cannot be empty.")
    if len(content) > 1000:
        raise LLMError("Memory is too long (max 1000 characters).")
    if kind not in config.MEMORY_KINDS:
        kind = "fact"
    mid = db.new_id()
    db.execute("INSERT INTO memories(id,content,kind,category,source,active,created_at,updated_at) "
               "VALUES(?,?,?,?,?,1,?,?)",
               (mid, content, kind, category, source, db.now(), db.now()))
    db.log_event("memory_add", detail={"kind": kind})
    return db.query_one("SELECT * FROM memories WHERE id=?", (mid,))


def get(mem_id: str):
    return db.query_one("SELECT * FROM memories WHERE id=?", (mem_id,))


def update(mem_id: str, fields: dict) -> dict:
    m = get(mem_id)
    if not m:
        raise LLMError("Memory not found.")
    sets, args = [], []
    if "content" in fields and (fields["content"] or "").strip():
        sets.append("content=?"); args.append(fields["content"].strip()[:1000])
    if "kind" in fields and fields["kind"] in config.MEMORY_KINDS:
        sets.append("kind=?"); args.append(fields["kind"])
    if "category" in fields:
        sets.append("category=?"); args.append(fields["category"])
    if "active" in fields:
        sets.append("active=?"); args.append(1 if fields["active"] else 0)
    if sets:
        sets.append("updated_at=?"); args.append(db.now()); args.append(mem_id)
        db.execute(f"UPDATE memories SET {', '.join(sets)} WHERE id=?", tuple(args))
    return get(mem_id)


def delete(mem_id: str):
    if not get(mem_id):
        raise LLMError("Memory not found.")
    db.execute("DELETE FROM memories WHERE id=?", (mem_id,))
    db.log_event("memory_delete", detail={"id": mem_id})


def clear_all():
    n = db.query_one("SELECT COUNT(*) n FROM memories")["n"]
    db.execute("DELETE FROM memories")
    return n


def search(q: str):
    rows = db.query("SELECT * FROM memories WHERE active=1")
    if not q:
        return rows
    q_tokens = {t for t in re.findall(r"[a-z0-9]{3,}", q.lower())}
    scored = []
    for m in rows:
        m_tokens = {t for t in re.findall(r"[a-z0-9]{3,}", m["content"].lower())}
        score = len(q_tokens & m_tokens)
        if score:
            scored.append((score, m))
    scored.sort(key=lambda x: -x[0])
    return [m for _, m in scored]


# ---------- suggestions (never auto-stored) ----------

def create_suggestion(content: str, kind: str = "fact", source: str = "chat") -> dict:
    content = (content or "").strip()
    if not content:
        raise LLMError("Suggestion content cannot be empty.")
    sid = db.new_id()
    db.execute("INSERT INTO suggestions(id,content,kind,status,source,created_at) VALUES(?,?,?,?,?,?)",
               (sid, content[:1000], kind, "pending", source, db.now()))
    return db.query_one("SELECT * FROM suggestions WHERE id=?", (sid,))


def pending():
    return db.query("SELECT * FROM suggestions WHERE status='pending' ORDER BY created_at DESC")


def approve(sid: str) -> dict:
    s = db.query_one("SELECT * FROM suggestions WHERE id=? AND status='pending'", (sid,))
    if not s:
        raise LLMError("Suggestion not found or already resolved.")
    memory = add(s["content"], kind=s["kind"], source="approved")
    db.execute("UPDATE suggestions SET status='approved', resolved_at=? WHERE id=?",
               (db.now(), sid))
    db.log_event("memory_approved", detail={"id": sid})
    return memory


def reject(sid: str):
    s = db.query_one("SELECT * FROM suggestions WHERE id=? AND status='pending'", (sid,))
    if not s:
        raise LLMError("Suggestion not found or already resolved.")
    db.execute("UPDATE suggestions SET status='rejected', resolved_at=? WHERE id=?", (db.now(), sid))
