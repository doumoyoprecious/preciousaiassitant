"""Precious AI — application entry point."""
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db
from .providers.base import LLMError
from .rag import embedder
from .routers import admin, auth_router, chat, eval_router, knowledge, memory, training

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("precious")

app = FastAPI(title="Precious AI", version="1.0.0")


# ---------- error handling: never expose raw technical errors ----------

@app.exception_handler(HTTPException)
async def http_error_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code,
                        content={"error": exc.detail if isinstance(exc.detail, str) else "Request failed."},
                        headers=exc.headers)


@app.exception_handler(LLMError)
async def llm_error_handler(request: Request, exc: LLMError):
    db.log_error("llm", exc.message, level="warn", detail=f"code={exc.code} path={request.url.path}")
    return JSONResponse(status_code=400, content={"error": exc.message})


@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    db.log_error("server", f"{exc.__class__.__name__}: {exc}",
                detail=(request.url.path + " | " + repr(exc))[:4000])
    return JSONResponse(status_code=500,
                        content={"error": "Something went wrong on my side. Please try again — "
                                          "if it keeps happening, check Admin → Error logs."})


# ---------- API routes ----------

app.include_router(auth_router.router)
app.include_router(chat.router)
app.include_router(knowledge.router)
app.include_router(memory.router)
app.include_router(training.router)
app.include_router(admin.router)
app.include_router(eval_router.router)


@app.get("/api/health")
def health():
    owner = db.query_one("SELECT username FROM owner LIMIT 1")
    settings = db.all_settings()
    from .providers import registry
    key = registry.resolve_api_key(settings.get("provider", "groq"))
    return {
        "ok": True,
        "owner_configured": bool(owner),
        "provider": settings.get("provider"),
        "model": settings.get("model"),
        "api_key_configured": bool(key),
        "embedder": embedder.backend(),
        "embedder_state": embedder.state(),
        "kb_chunks": db.query_one("SELECT COUNT(*) n FROM chunks")["n"],
        "kb_documents": db.query_one("SELECT COUNT(*) n FROM documents WHERE status='ready'")["n"],
    }


# ---------- static frontend ----------

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
