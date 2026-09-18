"""Knowledge base management: upload, manual text, URLs, replace, search."""
import hashlib
import re
from pathlib import Path

from .. import config, db
from ..providers.base import LLMError
from ..rag import chunk as chunkmod
from ..rag import embedder, extract, store

MAX_NAME_LEN = 160


def _validate_name(name: str) -> str:
    name = Path(name or "untitled").name  # strip any directory parts
    return name[:MAX_NAME_LEN] or "untitled"


def add_file(filename: str, content: bytes, category: str, source_type: str = "upload") -> dict:
    name = _validate_name(filename)
    ext = Path(name).suffix.lower()
    if ext not in extract.SUPPORTED_EXTS:
        raise LLMError(f"'{name}': unsupported file type. Supported: PDF, TXT, MD, DOCX, CSV.")
    if len(content) > extract.MAX_FILE_BYTES:
        raise LLMError(f"'{name}' is larger than 25 MB.")
    if len(content) == 0:
        raise LLMError(f"'{name}' is empty.")
    category = category if category in config.CATEGORIES else "General Knowledge"

    doc_id = db.new_id()
    content_hash = hashlib.sha256(content).hexdigest()
    stored_path = config.UPLOADS_DIR / f"{doc_id}{ext}"
    stored_path.write_bytes(content)

    try:
        data = extract.extract_file(stored_path, name)
    except extract.ExtractError as e:
        stored_path.unlink(missing_ok=True)
        raise LLMError(str(e))

    target = int(db.get_setting("chunk_size", 700) or 700)
    chunks = chunkmod.chunk_document(data["text"], data.get("page_texts"), target=target)
    if not chunks:
        stored_path.unlink(missing_ok=True)
        raise LLMError(f"No indexable text could be extracted from '{name}'.")

    n = store.add_chunks(doc_id, name, category, chunks)
    preview = re.sub(r"\s+", " ", data["text"])[:300]
    now = db.now()
    db.execute(
        "INSERT INTO documents(id,name,category,source_type,file_path,content_hash,size_bytes,pages,chunks,status,is_authoritative,is_outdated,preview,added_at,updated_at) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,0,0,?,?,?)",
        (doc_id, name, category, source_type, str(stored_path), content_hash,
         len(content), data.get("pages"), n, "ready", preview, now, now))
    db.log_event("knowledge_add", detail={"doc": name, "chunks": n, "category": category})
    return db.query_one("SELECT * FROM documents WHERE id=?", (doc_id,))


def add_manual(title: str, content: str, category: str, kind: str = "note") -> dict:
    title = (title or "").strip()[:MAX_NAME_LEN] or "Untitled note"
    content = (content or "").strip()
    if not content:
        raise LLMError("Content cannot be empty.")
    if category not in config.CATEGORIES:
        category = "General Knowledge"
    name = f"{title} ({kind})" if kind not in ("note",) else title
    doc_id = db.new_id()
    target = int(db.get_setting("chunk_size", 700) or 700)
    chunks = chunkmod.chunk_text(content, target=target)
    n = store.add_chunks(doc_id, name, category, chunks)
    now = db.now()
    preview = re.sub(r"\s+", " ", content)[:300]
    db.execute(
        "INSERT INTO documents(id,name,category,source_type,file_path,content_hash,size_bytes,pages,chunks,status,is_authoritative,is_outdated,preview,added_at,updated_at) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,0,0,?,?,?)",
        (doc_id, name, category, kind, None, None, len(content.encode()), None,
         n, "ready", preview, now, now))
    db.log_event("knowledge_add", detail={"doc": name, "chunks": n, "manual": True})
    return db.query_one("SELECT * FROM documents WHERE id=?", (doc_id,))


def add_url(url: str, category: str, title: str = None) -> dict:
    try:
        data = extract.extract_url(url)
    except extract.ExtractError as e:
        raise LLMError(str(e))
    name = (title or data.get("title") or url)[:MAX_NAME_LEN]
    doc_id = db.new_id()
    target = int(db.get_setting("chunk_size", 700) or 700)
    chunks = chunkmod.chunk_text(data["text"], target=target)
    n = store.add_chunks(doc_id, name, category, chunks)
    now = db.now()
    preview = re.sub(r"\s+", " ", data["text"])[:300]
    db.execute(
        "INSERT INTO documents(id,name,category,source_type,file_path,content_hash,size_bytes,pages,chunks,status,is_authoritative,is_outdated,preview,added_at,updated_at) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,0,0,?,?,?)",
        (doc_id, name, category, "url", None, None, len(data["text"].encode()), None,
         n, "ready", preview, now, now))
    db.execute("UPDATE documents SET file_path=? WHERE id=?", (url, doc_id))
    return db.query_one("SELECT * FROM documents WHERE id=?", (doc_id,))


def get(doc_id: str):
    return db.query_one("SELECT * FROM documents WHERE id=?", (doc_id,))


def delete(doc_id: str):
    doc = get(doc_id)
    if not doc:
        raise LLMError("Document not found.")
    store.delete_doc(doc_id)
    if doc.get("file_path"):
        try:
            p = Path(doc["file_path"])
            if str(p).startswith(str(config.UPLOADS_DIR)) and p.exists():
                p.unlink()
        except OSError:
            pass
    db.execute("DELETE FROM documents WHERE id=?", (doc_id,))
    db.log_event("knowledge_delete", detail={"doc": doc["name"]})


def replace(doc_id: str, filename: str, content: bytes) -> dict:
    doc = get(doc_id)
    if not doc:
        raise LLMError("Document not found.")
    ext = Path(filename).suffix.lower()
    if ext not in extract.SUPPORTED_EXTS:
        raise LLMError("Unsupported replacement file type.")
    old_file = doc.get("file_path")
    # remove old
    store.delete_doc(doc_id)
    if old_file:
        try:
            p = Path(old_file)
            if str(p).startswith(str(config.UPLOADS_DIR)) and p.exists():
                p.unlink()
        except OSError:
            pass
    db.execute("DELETE FROM documents WHERE id=?", (doc_id,))
    # add fresh, preserving id/category
    fresh = add_file(filename, content, category=doc["category"], source_type=doc["source_type"])
    db.execute("UPDATE documents SET id=? WHERE id=?", (doc_id, fresh["id"]))
    db.execute("UPDATE chunks SET doc_id=? WHERE doc_id=?", (doc_id, fresh["id"]))
    return get(doc_id)


def update(doc_id: str, fields: dict) -> dict:
    doc = get(doc_id)
    if not doc:
        raise LLMError("Document not found.")
    sets, args = [], []
    if "category" in fields:
        if fields["category"] not in config.CATEGORIES:
            raise LLMError("Unknown category.")
        sets.append("category=?"); args.append(fields["category"])
    if "is_authoritative" in fields:
        sets.append("is_authoritative=?"); args.append(1 if fields["is_authoritative"] else 0)
    if "is_outdated" in fields:
        sets.append("is_outdated=?"); args.append(1 if fields["is_outdated"] else 0)
    if "name" in fields:
        sets.append("name=?"); args.append(str(fields["name"])[:MAX_NAME_LEN])
    if sets:
        sets.append("updated_at=?"); args.append(db.now()); args.append(doc_id)
        db.execute(f"UPDATE documents SET {', '.join(sets)} WHERE id=?", tuple(args))
        # category must propagate to chunks for filtered search
        if "category" in fields:
            db.execute("UPDATE chunks SET category=? WHERE doc_id=?",
                       (fields["category"], doc_id))
    return get(doc_id)


def search(q: str, category: str = None, limit: int = 10):
    q = (q or "").strip()
    if not q:
        return []
    vec = embedder.embed([q])[0]
    min_score = float(db.get_setting("rag_min_score", 0.25) or 0.25)
    return store.search(vec, top_k=limit, min_score=min_score, category=category)


def list_docs(category: str = None) -> list:
    if category:
        return db.query("SELECT * FROM documents WHERE category=? ORDER BY updated_at DESC", (category,))
    return db.query("SELECT * FROM documents ORDER BY updated_at DESC")


def stats() -> dict:
    docs = db.query_one("SELECT COUNT(*) n, COALESCE(SUM(size_bytes),0) bytes FROM documents") or {"n": 0, "bytes": 0}
    chunks = store.count()
    return {"documents": docs["n"], "bytes": docs["bytes"], "chunks": chunks,
            "embedder": embedder.backend(), "embedder_state": embedder.state()}
