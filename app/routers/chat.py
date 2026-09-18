"""Chat: conversations, messages, feedback, regenerate."""
import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

from .. import auth, db
from ..agent import engine
from ..providers.base import LLMError

router = APIRouter(prefix="/api", tags=["chat"])

MAX_FILES = 5
MAX_FILE_BYTES = 25 * 1024 * 1024


def _conv(conv_id: str):
    conv = db.query_one("SELECT * FROM conversations WHERE id=?", (conv_id,))
    if not conv:
        raise HTTPException(404, "Conversation not found.")
    return conv


class FeedbackIn(BaseModel):
    rating: str  # up | down | issue
    note: str = ""
    corrected_answer: str = ""


EVAL_TITLE = "__eval__"


@router.get("/conversations")
def list_conversations(user=Depends(auth.require_user)):
    rows = db.query(
        "SELECT c.id, c.title, c.created_at, c.updated_at, "
        "(SELECT COUNT(*) FROM messages m WHERE m.conv_id=c.id) AS message_count, "
        "(SELECT content FROM messages m WHERE m.conv_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_content "
        "FROM conversations c WHERE c.title != ? ORDER BY c.updated_at DESC LIMIT 200", (EVAL_TITLE,))
    for r in rows:
        r["last_content"] = (r.get("last_content") or "")[:80]
    return rows


@router.get("/conversations/search")
def search_conversations(q: str = "", user=Depends(auth.require_user)):
    q = (q or "").strip()
    if not q:
        return []
    like = f"%{q}%"
    conv_ids = {r["conv_id"] for r in db.query(
        "SELECT DISTINCT conv_id FROM messages WHERE content LIKE ? LIMIT 200", (like,))}
    out = []
    for c in db.query("SELECT * FROM conversations WHERE title LIKE ? AND title != ? ORDER BY updated_at DESC",
                      (like, EVAL_TITLE)):
        conv_ids.add(c["id"])
        out.append(c)
    have = {c["id"] for c in out}
    for cid in sorted(conv_ids - have):
        row = db.query_one("SELECT * FROM conversations WHERE id=?", (cid,))
        if row:
            out.append(row)
    return out[:50]


@router.post("/conversations")
def create_conversation(body: dict = None, user=Depends(auth.require_user)):
    title = (body or {}).get("title") or "New conversation"
    conv_id = db.new_id()
    db.execute("INSERT INTO conversations(id,title,created_at,updated_at) VALUES(?,?,?,?)",
               (conv_id, str(title)[:120], db.now(), db.now()))
    return db.query_one("SELECT * FROM conversations WHERE id=?", (conv_id,))


@router.get("/conversations/{conv_id}/messages")
def get_messages(conv_id: str, user=Depends(auth.require_user)):
    _conv(conv_id)
    rows = db.query("SELECT * FROM messages WHERE conv_id=? ORDER BY created_at", (conv_id,))
    import json
    for r in rows:
        for k in ("sources", "steps"):
            try:
                r[k] = json.loads(r[k]) if r[k] else []
            except ValueError:
                r[k] = []
    return rows


@router.get("/conversations/{conv_id}")
def get_conversation(conv_id: str, user=Depends(auth.require_user)):
    return _conv(conv_id)


@router.patch("/conversations/{conv_id}")
def rename_conversation(conv_id: str, body: dict, user=Depends(auth.require_user)):
    _conv(conv_id)
    title = re.sub(r"\s+", " ", (body or {}).get("title", "")).strip()[:120]
    if not title:
        raise HTTPException(400, "Title cannot be empty.")
    db.execute("UPDATE conversations SET title=? WHERE id=?", (title, conv_id))
    return db.query_one("SELECT * FROM conversations WHERE id=?", (conv_id,))


@router.delete("/conversations/{conv_id}")
def delete_conversation(conv_id: str, user=Depends(auth.require_user)):
    _conv(conv_id)
    db.execute("DELETE FROM messages WHERE conv_id=?", (conv_id,))
    db.execute("DELETE FROM conversations WHERE id=?", (conv_id,))
    return {"ok": True}


@router.post("/conversations/{conv_id}/clear")
def clear_conversation(conv_id: str, user=Depends(auth.require_user)):
    _conv(conv_id)
    db.execute("DELETE FROM messages WHERE conv_id=?", (conv_id,))
    db.execute("UPDATE conversations SET title='New conversation', updated_at=? WHERE id=?",
               (db.now(), conv_id))
    return {"ok": True}


@router.post("/conversations/{conv_id}/messages")
async def send_message(
    request: Request,
    conv_id: str,
    content: str = Form(default=""),
    training: str = Form(default="false"),
    files: list[UploadFile] = File(default=[]),
    user=Depends(auth.require_user),
):
    _conv(conv_id)
    auth.check_rate(request, "llm", 30, 60)  # 30 LLM calls/min/session — protects provider budget
    content = (content or "").strip()
    uploaded = []
    for f in files[:MAX_FILES]:
        data = await f.read()
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(400, f"'{f.filename}' is larger than 25 MB.")
        if len(data) == 0:
            raise HTTPException(400, f"'{f.filename}' is empty.")
        uploaded.append({"filename": f.filename, "content": data})
    if not content and not uploaded:
        raise HTTPException(400, "Send some text or attach a file.")
    if len(content) > 20000:
        raise HTTPException(400, "Message is too long (max 20,000 characters).")

    text = content or f"Here is a new document for your knowledge base: {', '.join(f['filename'] for f in uploaded)}"
    engine.send_user_message(conv_id, text, training=training == "true")
    try:
        return engine.run_turn(conv_id, text, files=uploaded or None, training=training == "true")
    except LLMError as e:
        db.log_error("chat", e.message, level="warn", detail=content[:200])
        raise HTTPException(400, e.message)


@router.post("/conversations/{conv_id}/retry")
def retry(request: Request, conv_id: str, user=Depends(auth.require_user)):
    _conv(conv_id)
    auth.check_rate(request, "llm", 30, 60)
    try:
        return engine.retry_last(conv_id)
    except LLMError as e:
        raise HTTPException(400, e.message)


@router.post("/messages/{message_id}/regenerate")
def regenerate(request: Request, message_id: str, user=Depends(auth.require_user)):
    msg = db.query_one("SELECT * FROM messages WHERE id=?", (message_id,))
    if not msg:
        raise HTTPException(404, "Message not found.")
    auth.check_rate(request, "llm", 30, 60)
    try:
        return engine.regenerate(msg["conv_id"], message_id)
    except LLMError as e:
        raise HTTPException(400, e.message)


@router.post("/messages/{message_id}/feedback")
def feedback(message_id: str, body: FeedbackIn, user=Depends(auth.require_user)):
    if body.rating not in ("up", "down", "issue"):
        raise HTTPException(400, "Invalid rating.")
    msg = db.query_one("SELECT * FROM messages WHERE id=?", (message_id,))
    if not msg:
        raise HTTPException(404, "Message not found.")
    db.execute("DELETE FROM feedback WHERE message_id=?", (message_id,))
    fid = db.new_id()
    db.execute("INSERT INTO feedback(id,message_id,conv_id,rating,note,corrected_answer,created_at) "
               "VALUES(?,?,?,?,?,?,?)",
               (fid, message_id, msg["conv_id"], body.rating,
                body.note.strip()[:2000], body.corrected_answer.strip()[:5000], db.now()))
    db.log_event("feedback", detail={"rating": body.rating, "message": message_id})
    return {"ok": True}
