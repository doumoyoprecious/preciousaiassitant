"""Precious AI — application entry point."""
import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db
from .providers.base import LLMError
from .rag import embedder
from .routers import admin, auth_router, chat, eval_router, knowledge, memory, training

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("precious")

app = FastAPI(title="Precious AI", version="1.0.0")

# ---------- security headers (production checklist) ----------

CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; "
    "connect-src 'self'; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "frame-ancestors 'none'; "
    "form-action 'self'"
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("Content-Security-Policy", CSP)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault("X-XSS-Protection", "0")
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


# ---------- CORS for split hosting (Vercel UI -> API server) ----------
# Same-origin deployments need nothing; set PA_CORS_ORIGINS="https://app.vercel.app"
# when the frontend is hosted separately.

_cors_origins = [o.strip() for o in os.environ.get("PA_CORS_ORIGINS", "").split(",") if o.strip()]
if _cors_origins:
    app.add_middleware(CORSMiddleware, allow_origins=_cors_origins,
                       allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


# ---------- error handling: never expose raw technical errors ----------

@app.exception_handler(HTTPException)
async def http_error_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code,
                        content={"error": exc.detail if isinstance(exc.detail, str) else "Request failed."},
                        headers=exc.headers)


@app.exception_handler(LLMError)
async def llm_error_handler(request: Request, exc: LLMError):
    detail = f"code={exc.code} path={request.url.path}"
    if getattr(exc, "detail", None):
        detail += f" | provider said: {exc.detail}"
    db.log_error("llm", exc.message, level="warn", detail=detail)
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
