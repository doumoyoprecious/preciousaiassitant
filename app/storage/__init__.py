"""Storage layer: pluggable persistence backend.

Selected by the PA_STORAGE environment variable:
    sqlite   (default)  -> SQLiteProvider (file DB; /tmp on Vercel = ephemeral)
    postgres           -> PostgresProvider (PA_DATABASE_URL; persistent)
"""
import threading

from .. import config
from .base import StorageProvider

__all__ = ["StorageProvider", "create_provider", "get_provider"]

_provider = None
_lock = threading.Lock()


def create_provider() -> StorageProvider:
    if config.STORAGE == "postgres":
        from .postgres_provider import PostgresProvider
        return PostgresProvider()
    if config.STORAGE == "sqlite":
        from .sqlite_provider import SQLiteProvider
        return SQLiteProvider()
    raise RuntimeError(f"Unknown PA_STORAGE '{config.STORAGE}' (expected 'sqlite' or 'postgres').")


def get_provider() -> StorageProvider:
    global _provider
    if _provider is None:
        with _lock:
            if _provider is None:
                _provider = create_provider()
    return _provider
