"""Owner dashboard analytics computed from real stored data."""
import re
import time
from collections import Counter

from .. import db
from ..rag import embedder


def _daily_counts(days=14):
    since = int(time.time()) - days * 86400
    rows = db.query("SELECT created_at FROM messages WHERE role='assistant' AND created_at>?", (since,))
    counts = Counter((t["created_at"] // 86400) for t in rows)
    today = int(time.time()) // 86400
    out = []
    for i in range(days - 1, -1, -1):
        day = today - i
        out.append({"day": time.strftime("%a %d", time.gmtime(day * 86400)),
                    "count": counts.get(day, 0)})
    return out


def _top_questions(limit=8):
    rows = db.query("SELECT content FROM messages WHERE role='user'")
    c = Counter()
    for r in rows:
        norm = re.sub(r"[^a-z0-9 ]+", "", r["content"].lower()).strip()
        norm = re.sub(r"\s+", " ", norm)
        if len(norm) >= 12:
            c[norm[:80]] += 1
    return [{"question": q, "count": n} for q, n in c.most_common(limit) if n >= 1][:limit]


def _knowledge_gaps(limit=6):
    """'Not helpful' feedback on answers that had no sources = likely knowledge gaps."""
    rows = db.query(
        "SELECT f.id, f.note, f.corrected_answer, u.content AS question, c.title AS conv_title "
        "FROM feedback f "
        "JOIN messages am ON am.id=f.message_id AND am.role='assistant' "
        "LEFT JOIN messages u ON u.conv_id=am.conv_id AND u.role='user' AND u.created_at<=am.created_at "
        "LEFT JOIN conversations c ON c.id=am.conv_id "
        "WHERE f.rating IN ('down','issue') "
        "ORDER BY f.created_at DESC LIMIT ?", (limit * 3,))
    out = []
    for r in rows:
        out.append({"id": r["id"], "note": r["note"], "corrected_answer": r["corrected_answer"],
                    "question": (r["question"] or "")[:160], "conv_title": r["conv_title"]})
        if len(out) >= limit:
            break
    return out


def overview() -> dict:
    counts = {
        "conversations": db.query_one("SELECT COUNT(*) n FROM conversations")["n"],
        "messages": db.query_one("SELECT COUNT(*) n FROM messages WHERE role='assistant'")["n"],
        "user_messages": db.query_one("SELECT COUNT(*) n FROM messages WHERE role='user'")["n"],
        "documents": db.query_one("SELECT COUNT(*) n FROM documents WHERE status='ready'")["n"],
        "chunks": db.query_one("SELECT COUNT(*) n FROM chunks")["n"],
        "memories": db.query_one("SELECT COUNT(*) n FROM memories WHERE active=1")["n"],
        "pending_suggestions": db.query_one("SELECT COUNT(*) n FROM suggestions WHERE status='pending'")["n"],
    }
    fb = {r["rating"]: r["n"] for r in db.query("SELECT rating, COUNT(*) n FROM feedback GROUP BY rating")}
    helpful = fb.get("up", 0)
    total_fb = helpful + fb.get("down", 0) + fb.get("issue", 0)
    failed_retrievals = db.query_one(
        "SELECT COUNT(*) n FROM chat_events WHERE type='retrieval' AND detail LIKE '%\"results\": 0%'")["n"]
    unanswered = db.query_one("SELECT COUNT(*) n FROM messages WHERE role='assistant' AND error IS NOT NULL")["n"]
    recent_errors = db.query("SELECT * FROM error_logs ORDER BY created_at DESC LIMIT 10")
    return {
        "counts": counts,
        "daily": _daily_counts(),
        "top_questions": _top_questions(),
        "feedback": {
            "helpful": helpful,
            "not_helpful": fb.get("down", 0),
            "issues": fb.get("issue", 0),
            "helpful_rate": round(helpful / total_fb, 3) if total_fb else None,
        },
        "failed_retrievals": failed_retrievals,
        "unanswered": unanswered,
        "knowledge_gaps": _knowledge_gaps(),
        "recent_errors": recent_errors,
        "embedder": embedder.backend(),
        "embedder_state": embedder.state(),
    }
