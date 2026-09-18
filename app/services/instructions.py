"""Versioned agent instructions (editable without code changes)."""
import json

from .. import db
from ..providers.base import LLMError

FIELDS = ["personality", "tone", "length", "domain", "formats", "business",
          "safety", "rules", "restrictions", "terminology"]


def _normalize(fields: dict) -> dict:
    out = {}
    for k in FIELDS:
        v = fields.get(k, "")
        if k in ("rules", "restrictions", "terminology"):
            if isinstance(v, str):
                items = [x.strip() for x in v.splitlines()]
                v = [x for x in items if x]
            elif isinstance(v, list):
                v = [str(x).strip() for x in v if str(x).strip()]
            else:
                v = []
        else:
            v = str(v or "").strip()
        out[k] = v
    return out


def history() -> list:
    rows = db.query("SELECT * FROM instructions ORDER BY version DESC")
    active = int(db.get_setting("active_instruction_version", "1") or 1)
    out = []
    for r in rows:
        try:
            fields = json.loads(r["fields"])
        except ValueError:
            fields = {}
        out.append({"version": r["version"], "fields": fields, "note": r["note"],
                    "created_at": r["created_at"], "active": r["version"] == active})
    return out


def save(fields: dict, note: str = None) -> dict:
    cleaned = _normalize(fields)
    rows = db.query("SELECT MAX(version) m FROM instructions")
    next_version = (rows[0]["m"] if rows and rows[0]["m"] else 0) + 1
    db.execute("INSERT INTO instructions(version,fields,note,created_at) VALUES(?,?,?,?)",
               (next_version, json.dumps(cleaned), (note or "").strip()[:200], db.now()))
    db.set_setting("active_instruction_version", str(next_version))
    db.log_event("instructions_save", detail={"version": next_version})
    return {"version": next_version, "active": True}


def activate(version: int) -> dict:
    row = db.query_one("SELECT * FROM instructions WHERE version=?", (version,))
    if not row:
        raise LLMError("Instruction version not found.")
    db.set_setting("active_instruction_version", str(version))
    db.log_event("instructions_activate", detail={"version": version})
    return {"version": version, "active": True}
