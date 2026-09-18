"""Knowledge base API (owner)."""
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from .. import auth, config
from ..providers.base import LLMError
from ..services import knowledge as kb

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


class ManualIn(BaseModel):
    title: str = ""
    content: str
    category: str = "General Knowledge"
    kind: str = "note"  # note | faq | fact | structured


class UrlIn(BaseModel):
    url: str
    category: str = "General Knowledge"
    title: str = None


class PatchIn(BaseModel):
    category: str = None
    is_authoritative: bool = None
    is_outdated: bool = None
    name: str = None


def _guard(e: LLMError):
    raise HTTPException(400, e.message)


@router.get("")
def list_docs(category: str = None, user=Depends(auth.require_owner)):
    return kb.list_docs(category)


@router.get("/stats")
def stats(user=Depends(auth.require_owner)):
    return kb.stats()


@router.get("/search")
def search(q: str = "", category: str = None, limit: int = 10, user=Depends(auth.require_owner)):
    if limit > 25:
        limit = 25
    return {"query": q, "results": kb.search(q, category, limit)}


@router.post("/upload")
async def upload(file: UploadFile = File(...), category: str = Form(default="General Knowledge"),
                 user=Depends(auth.require_owner)):
    data = await file.read()
    try:
        return kb.add_file(file.filename, data, category)
    except LLMError as e:
        _guard(e)


@router.post("/manual")
def manual(body: ManualIn, user=Depends(auth.require_owner)):
    try:
        return kb.add_manual(body.title, body.content, body.category, body.kind)
    except LLMError as e:
        _guard(e)


@router.post("/url")
def add_url(body: UrlIn, user=Depends(auth.require_owner)):
    try:
        return kb.add_url(body.url, body.category, body.title)
    except LLMError as e:
        _guard(e)
    except Exception:
        raise HTTPException(500, "Failed to fetch that URL.")


@router.post("/{doc_id}/replace")
async def replace(doc_id: str, file: UploadFile = File(...), user=Depends(auth.require_owner)):
    data = await file.read()
    try:
        return kb.replace(doc_id, file.filename, data)
    except LLMError as e:
        _guard(e)


@router.patch("/{doc_id}")
def patch(doc_id: str, body: PatchIn, user=Depends(auth.require_owner)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        return kb.update(doc_id, fields)
    except LLMError as e:
        _guard(e)


@router.delete("/{doc_id}")
def delete(doc_id: str, user=Depends(auth.require_owner)):
    try:
        kb.delete(doc_id)
        return {"ok": True}
    except LLMError as e:
        _guard(e)


@router.get("/categories")
def categories(user=Depends(auth.require_owner)):
    return config.CATEGORIES
