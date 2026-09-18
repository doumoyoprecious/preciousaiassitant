"""Provider factory: turns settings + stored keys into a provider instance."""
import os

from .. import config, db
from .anthropic import Anthropic
from .base import LLMError
from .gemini import Gemini
from .openai_compat import OpenAICompat


def resolve_api_key(provider: str):
    """DB-stored key (Admin UI) takes precedence, then environment variable."""
    row = db.query_one("SELECT key FROM api_keys WHERE provider=?", (provider,))
    if row and row["key"]:
        return row["key"]
    return os.environ.get(config.ENV_KEY_NAMES.get(provider, ""), "") or None


def get_provider(provider: str, base_url_override: str = None) -> object:
    if provider == "anthropic":
        return Anthropic()
    if provider == "gemini":
        return Gemini()
    base = base_url_override or config.PROVIDER_BASE_URLS.get(provider)
    if not base:
        raise LLMError(f"Unknown or unsupported provider '{provider}'.", "config")
    return OpenAICompat(provider, base)


def provider_display(provider: str) -> str:
    return {"groq": "Groq", "openai": "OpenAI", "anthropic": "Anthropic",
            "gemini": "Google Gemini", "openrouter": "OpenRouter",
            "ollama": "Ollama (local)"}.get(provider, provider)
