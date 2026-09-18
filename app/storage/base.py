"""Storage provider interface.

The application talks to data exclusively through the app.db facade, which
delegates to one of two providers:

  * sqlite   — file database. Default. Great on a dev box or a small API
               server with a real disk. On Vercel it lives in /tmp and is
               EPHEMERAL (lost when the function instance is recycled).
  * postgres — external Postgres (Neon, Supabase, Railway, RDS, ...).
               The persistent backend for Vercel serverless deployments.

All SQL in the codebase is written in the SQLite dialect; the postgres
provider translates it transparently (placeholders, OR IGNORE/REPLACE).
"""
from abc import ABC, abstractmethod


class StorageProvider(ABC):
    kind = "base"
    persistent = False  # True when data survives process/instance restarts

    @abstractmethod
    def init(self):
        """Open connection, create schema + defaults. Idempotent. Must never
        write to the (read-only on Vercel) deployment filesystem."""

    @abstractmethod
    def query(self, sql, args=()) -> list:
        """Return list of row dicts."""

    @abstractmethod
    def query_one(self, sql, args=()):
        """Return first row dict or None."""

    @abstractmethod
    def execute(self, sql, args=()):
        """Run a write statement; auto-commits."""

    @abstractmethod
    def executemany(self, sql, seq):
        """Run a write statement for many parameter sets; auto-commits."""

    @abstractmethod
    def list_tables(self) -> list:
        """Names of application tables (dialect-neutral)."""

    def describe(self) -> dict:
        """Human/ops-friendly description (must never leak credentials)."""
        return {"kind": self.kind, "persistent": self.persistent}
