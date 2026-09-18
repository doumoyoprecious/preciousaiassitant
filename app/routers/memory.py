"""Long-term memory + suggestions API (owner)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import auth, db
from ..providers.base import LLMError
from ..services import memory as mem

router = APIRouter(prefix="/api/memories", tags=["memory"])


class MemoryIn(BaseModel):
    content: str
    kind: str = "fact"
    category: str = "General"


class MemoryPatch(BaseModel):
    content: str = None
    kind: str = None
    category: str = None
    active: bool = None


def _guard(e: LLMError):
    raise HTTPException(400, e.message)


@router.get("")
def list_memories(user=Depends(auth.require_owner)):
    return db.query("SELECT * FROM memories ORDER BY updated_at DESC")


@router.get("/search")
def search(q: str = "", user=Depends(auth.require_owner)):
    return mem.search(q)


@router.post("")
def add(body: MemoryIn, user=Depends(auth.require_owner)):
    try:
        return mem.add(body.content, body.kind, body.category, source="manual")
    except LLMError as e:
        _guard(e)


@router.post("/clear")
def clear(user=Depends(auth.require_owner)):
    return {"deleted": mem.clear_all()}


@router.patch("/{mem_id}")
def patch(mem_id: str, body: MemoryPatch, user=Depends(auth.require_owner)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        return mem.update(mem_id, fields)
    except LLMError as e:
        _guard(e)


@router.delete("/{mem_id}")
def delete(mem_id: str, user=Depends(auth.require_owner)):
    try:
        mem.delete(mem_id)
        return {"ok": True}
    except LLMError as e:
        _guard(e)


@router.get("/suggestions")
def suggestions(user=Depends(auth.require_owner)):
    return mem.pending()


@router.post("/suggestions")
def suggest(body: MemoryIn, user=Depends(auth.require_owner)):
    try:
        return mem.create_suggestion(body.content, body.kind, source="manual")
    except LLMError as e:
        _guard(e)


@router.post("/suggestions/{sid}/approve")
def approve(sid: str, user=Depends(auth.require_owner)):
    try:
        return mem.approve(sid)
    except LLMError as e:
        _guard(e)


@router.post("/suggestions/{sid}/reject")
def reject(sid: str, user=Depends(auth.require_owner)):
    try:
        mem.reject(sid)
        return {"ok": True}
    except LLMError as e:
        _guard(e)
