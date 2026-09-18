"""Evaluation / testing API."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import auth, db
from ..services import evaluation as ev

router = APIRouter(prefix="/api/eval", tags=["eval"])


class CaseIn(BaseModel):
    question: str
    expected_behavior: str = ""
    expected_info: str = ""
    notes: str = ""


@router.get("/cases")
def list_cases(user=Depends(auth.require_owner)):
    return db.query("SELECT * FROM eval_cases ORDER BY created_at")


@router.post("/cases")
def create_case(body: CaseIn, user=Depends(auth.require_owner)):
    if not (body.question or "").strip():
        raise HTTPException(400, "Question cannot be empty.")
    cid = db.new_id()
    db.execute("INSERT INTO eval_cases(id,question,expected_behavior,expected_info,notes,created_at,updated_at) "
               "VALUES(?,?,?,?,?,?,?)",
               (cid, body.question.strip()[:2000], body.expected_behavior.strip()[:1000],
                body.expected_info.strip()[:2000], body.notes.strip()[:1000], db.now(), db.now()))
    return db.query_one("SELECT * FROM eval_cases WHERE id=?", (cid,))


@router.patch("/cases/{case_id}")
def update_case(case_id: str, body: CaseIn, user=Depends(auth.require_owner)):
    if not db.query_one("SELECT id FROM eval_cases WHERE id=?", (case_id,)):
        raise HTTPException(404, "Test case not found.")
    db.execute("UPDATE eval_cases SET question=?, expected_behavior=?, expected_info=?, notes=?, updated_at=? "
               "WHERE id=?",
               (body.question.strip()[:2000], body.expected_behavior.strip()[:1000],
                body.expected_info.strip()[:2000], body.notes.strip()[:1000], db.now(), case_id))
    return db.query_one("SELECT * FROM eval_cases WHERE id=?", (case_id,))


@router.delete("/cases/{case_id}")
def delete_case(case_id: str, user=Depends(auth.require_owner)):
    if not db.query_one("SELECT id FROM eval_cases WHERE id=?", (case_id,)):
        raise HTTPException(404, "Test case not found.")
    db.execute("DELETE FROM eval_runs WHERE case_id=?", (case_id,))
    db.execute("DELETE FROM eval_cases WHERE id=?", (case_id,))
    return {"ok": True}


class RunIn(BaseModel):
    case_id: str = ""


@router.post("/run")
def run(body: RunIn, user=Depends(auth.require_owner)):
    if body.case_id:
        case = db.query_one("SELECT * FROM eval_cases WHERE id=?", (body.case_id,))
        if not case:
            raise HTTPException(404, "Test case not found.")
        return {"runs": [ev.run_case(case)]}
    return {"runs": ev.run_all()}


@router.get("/runs")
def runs(case_id: str = None, limit: int = 50, user=Depends(auth.require_owner)):
    if limit > 200:
        limit = 200
    if case_id:
        return db.query("SELECT * FROM eval_runs WHERE case_id=? ORDER BY created_at DESC LIMIT ?",
                        (case_id, limit))
    return db.query("SELECT * FROM eval_runs ORDER BY created_at DESC LIMIT ?", (limit,))


@router.delete("/runs/{run_id}")
def delete_run(run_id: str, user=Depends(auth.require_owner)):
    db.execute("DELETE FROM eval_runs WHERE id=?", (run_id,))
    return {"ok": True}
