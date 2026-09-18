"""Training Mode: structured teaching (saves only what the owner explicitly teaches)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import auth
from ..providers.base import LLMError
from ..services import knowledge as kb
from ..services import memory as mem

router = APIRouter(prefix="/api/training", tags=["training"])


class TeachIn(BaseModel):
    target: str  # memory | faq | terminology | note
    content: str
    category: str = "General Knowledge"
    kind: str = "preference"  # for target=memory: preference|fact|terminology|workflow|business_rule|format
    title: str = ""


@router.post("/teach")
def teach(body: TeachIn, user=Depends(auth.require_owner)):
    content = (body.content or "").strip()
    if not content:
        raise HTTPException(400, "Teaching content cannot be empty.")
    if body.target == "memory":
        try:
            m = mem.add(content, kind=body.kind, category=body.category, source="training")
        except LLMError as e:
            raise HTTPException(400, e.message)
        return {"saved_to": "long-term memory", "item": m}
    # knowledge-side targets
    kind_map = {"faq": "faq", "terminology": "structured", "note": "note"}
    if body.target not in kind_map:
        raise HTTPException(400, "Unknown teaching target.")
    try:
        doc = kb.add_manual(body.title or content[:60], content, body.category, kind_map[body.target])
    except LLMError as e:
        raise HTTPException(400, e.message)
    return {"saved_to": "knowledge base", "item": doc}


@router.get("/summary")
def summary(user=Depends(auth.require_owner)):
    from .. import db
    return {
        "memories_from_training": db.query_one(
            "SELECT COUNT(*) n FROM memories WHERE source='training'")["n"],
        "knowledge_from_training": db.query_one(
            "SELECT COUNT(*) n FROM documents WHERE source_type IN ('faq','structured')")["n"],
    }
