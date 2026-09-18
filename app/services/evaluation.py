"""Evaluation / testing area: test cases, runs, auto-scoring and flags."""
import json
import re

from .. import db
from ..providers.base import LLMError
from ..agent import engine
from ..agent.engine import NOT_KNOWN_RE


def _split_phrases(expected_info: str):
    parts = re.split(r"[;,\n]|(?<=\.)\s+(?=[A-Z])", expected_info or "")
    out = []
    for p in parts:
        p = p.strip().strip('.!')
        if p:
            out.append(p)
    return out


def _phrase_hit(phrase: str, answer: str) -> bool:
    a = re.sub(r"[^a-z0-9 ]+", " ", answer.lower()).strip()
    p = re.sub(r"[^a-z0-9 ]+", " ", phrase.lower()).strip()
    if not p:
        return False
    if p in a:
        return True
    # fuzzy: token overlap
    p_tokens = {t for t in p.split() if len(t) > 2}
    a_tokens = set(a.split())
    if not p_tokens:
        return False
    return len(p_tokens & a_tokens) / len(p_tokens) >= 0.6


def run_case(case: dict) -> dict:
    settings = db.all_settings()
    conv = db.query_one("SELECT id FROM conversations WHERE title='__eval__' LIMIT 1")
    if not conv:
        conv_id = db.new_id()
        db.execute("INSERT INTO conversations(id,title,created_at,updated_at) VALUES(?,?,?,?)",
                   (conv_id, "__eval__", db.now(), db.now()))
    else:
        conv_id = conv["id"]
        db.execute("DELETE FROM messages WHERE conv_id=?", (conv_id,))

    error = None
    answer = ""
    sources = []
    try:
        result = engine.run_turn(conv_id, case["question"])
        answer = result["content"]
        sources = result["sources"]
    except LLMError as e:
        error = e.message

    phrases = _split_phrases(case.get("expected_info") or "")
    hits = []
    for p in phrases:
        hits.append({"phrase": p, "hit": _phrase_hit(p, answer or "")})
    score = (len([h for h in hits if h["hit"]]) / len(hits)) if hits else None

    flags = []
    if error:
        flags.append("error: " + error)
    if not error and sources == [] and not NOT_KNOWN_RE.search(answer or ""):
        # No retrieved knowledge, but the model answered confidently.
        flags.append("possible unsupported claim (no knowledge retrieved)")
    if not error and phrases and score is not None and score < 0.6:
        flags.append("missing expected information")
    if not error and sources and NOT_KNOWN_RE.search(answer or ""):
        flags.append("knowledge retrieved but answer says 'not found' (possible retrieval mismatch)")

    passed = (not error) and (score is None or score >= 0.6) and (
        "possible unsupported claim" not in " ".join(flags) or bool(sources))

    run_id = db.new_id()
    db.execute(
        "INSERT INTO eval_runs(id,case_id,question,answer,error,score,expected_hits,retrieval,passed,flags,notes,model,created_at) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (run_id, case["id"], case["question"], answer, error, score,
         json.dumps(hits), json.dumps(sources), 1 if passed else 0,
         json.dumps(flags), None, settings.get("model"), db.now()))
    db.log_event("eval_run", detail={"case": case["id"], "passed": bool(passed)})
    return db.query_one("SELECT * FROM eval_runs WHERE id=?", (run_id,))


def run_all() -> list:
    cases = db.query("SELECT * FROM eval_cases ORDER BY created_at")
    return [run_case(c) for c in cases]
