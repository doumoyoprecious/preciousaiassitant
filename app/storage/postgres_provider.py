"""Postgres storage provider (persistent backend for Vercel serverless).

Connect via PA_DATABASE_URL, e.g.
    postgres://user:password@ep-xxx.eu-central-1.aws.neon.tech/precious?sslmode=require

The application's SQL is written in the SQLite dialect; _adapt() translates
it transparently:
    ?                -> %s
    literal %        -> %%  (when parameters are present)
    INSERT OR IGNORE -> INSERT ... ON CONFLICT DO NOTHING
    INSERT OR REPLACE-> INSERT ... ON CONFLICT(<pk>) DO UPDATE SET ...

Bytes parameters adapt to BYTEA automatically (psycopg).
"""
import json
import re
import threading
import time
from urllib.parse import urlparse

import psycopg
import psycopg.rows

from .. import config
from .base import StorageProvider

# Postgres dialect of the schema (same tables/columns as the SQLite schema).
SCHEMA = """
CREATE TABLE IF NOT EXISTS owner(
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages(
  id TEXT PRIMARY KEY,
  conv_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  sources TEXT,
  steps TEXT,
  training INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conv_id, created_at);
CREATE TABLE IF NOT EXISTS documents(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General Knowledge',
  source_type TEXT NOT NULL DEFAULT 'upload',
  file_path TEXT,
  content_hash TEXT,
  size_bytes BIGINT,
  pages INTEGER,
  chunks INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  is_authoritative INTEGER NOT NULL DEFAULT 0,
  is_outdated INTEGER NOT NULL DEFAULT 0,
  preview TEXT,
  added_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks(
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  doc_name TEXT NOT NULL,
  category TEXT NOT NULL,
  idx INTEGER NOT NULL,
  page INTEGER,
  section TEXT,
  content TEXT NOT NULL,
  embedding BYTEA NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_chunks_cat ON chunks(category);
CREATE TABLE IF NOT EXISTS memories(
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fact',
  category TEXT NOT NULL DEFAULT 'General',
  source TEXT NOT NULL DEFAULT 'manual',
  active INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS suggestions(
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fact',
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'chat',
  created_at BIGINT NOT NULL,
  resolved_at BIGINT
);
CREATE TABLE IF NOT EXISTS feedback(
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  conv_id TEXT,
  rating TEXT NOT NULL,
  note TEXT,
  corrected_answer TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS instructions(
  version INTEGER PRIMARY KEY,
  fields TEXT NOT NULL,
  note TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS api_keys(provider TEXT PRIMARY KEY, key TEXT NOT NULL, updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS error_logs(
  id BIGSERIAL PRIMARY KEY,
  level TEXT NOT NULL,
  area TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_cases(
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  expected_behavior TEXT,
  expected_info TEXT,
  notes TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_runs(
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT,
  error TEXT,
  score DOUBLE PRECISION,
  expected_hits TEXT,
  retrieval TEXT,
  passed INTEGER,
  flags TEXT,
  notes TEXT,
  model TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_events(
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  conv_id TEXT,
  detail TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS tools_registry(
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  params TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  built_in INTEGER NOT NULL DEFAULT 1
);
"""


def _adapt(sql: str, args):
    """Translate SQLite-dialect SQL + `?` params to psycopg `%s` style."""
    s = sql.strip()
    upper = s.upper()
    if upper.startswith("INSERT OR IGNORE"):
        s = re.sub(r"^INSERT\s+OR\s+IGNORE", "INSERT", s, flags=re.I)
        s += " ON CONFLICT DO NOTHING"
    elif upper.startswith("INSERT OR REPLACE"):
        m = re.match(r"INSERT\s+OR\s+REPLACE\s+INTO\s+(\w+)\s*\(([^)]*)\)", s, re.I)
        if m:
            cols = [c.strip() for c in m.group(2).split(",")]
            pk = cols[0]
            others = [c for c in cols if c != pk]
            s = re.sub(r"^INSERT\s+OR\s+REPLACE", "INSERT", s, flags=re.I)
            if others:
                s += " ON CONFLICT (" + pk + ") DO UPDATE SET " + \
                     ", ".join(f"{c} = excluded.{c}" for c in others)
            else:
                s += f" ON CONFLICT ({pk}) DO NOTHING"
    if args:
        out = []
        in_str = False
        for ch in s:
            if ch == "'":
                in_str = not in_str
                out.append(ch)
            elif ch == "?" and not in_str:
                out.append("%s")
            elif ch == "%" and not in_str:
                out.append("%%")  # literal % for psycopg formatting
            else:
                out.append(ch)
        s = "".join(out)
    return s, tuple(args) if args else ()


class PostgresProvider(StorageProvider):
    kind = "postgres"
    persistent = True

    def __init__(self):
        self._conn = None
        self._lock = threading.Lock()

    # ---------- connection ----------

    def _connect(self):
        return psycopg.connect(config.DATABASE_URL, autocommit=True, connect_timeout=15)

    def init(self):
        if self._conn is not None:
            return
        if not config.DATABASE_URL:
            raise RuntimeError(
                "PA_STORAGE=postgres is set but PA_DATABASE_URL is empty. "
                "Provide a Postgres connection string (Neon, Supabase, Railway, RDS...).")
        self._conn = self._connect()
        self._conn.row_factory = psycopg.rows.dict_row
        with self._conn.cursor() as cur:
            cur.execute(SCHEMA)
        self._init_defaults()

    def _reconnect(self):
        try:
            if self._conn is not None:
                self._conn.close()
        except Exception:
            pass
        self._conn = None
        self.init()

    def _run(self, fn, retries=1):
        with self._lock:
            for attempt in range(retries + 1):
                try:
                    return fn()
                except psycopg.OperationalError:
                    if attempt >= retries:
                        raise
                    self._reconnect()

    # ---------- API ----------

    def query(self, sql, args=()):
        self.init()
        sql2, a2 = _adapt(sql, args)
        def go():
            with self._conn.cursor() as cur:
                # None (not ()) when there are no args: psycopg only interprets
                # % placeholders when parameters are actually passed.
                cur.execute(sql2, a2 or None)
                return cur.fetchall()
        return self._run(go)

    def query_one(self, sql, args=()):
        rows = self.query(sql, args)
        return rows[0] if rows else None

    def execute(self, sql, args=()):
        self.init()
        sql2, a2 = _adapt(sql, args)
        def go():
            with self._conn.cursor() as cur:
                cur.execute(sql2, a2 or None)
        self._run(go)

    def executemany(self, sql, seq):
        self.init()
        # Only the SQL text needs dialect translation; row values pass through.
        sql2, _ = _adapt(sql, (1,))
        seq = list(seq)
        if not seq:
            return

        def go():
            with self._conn.cursor() as cur:
                cur.executemany(sql2, seq)
        self._run(go)

    def list_tables(self) -> list:
        self.init()

        def go():
            with self._conn.cursor() as cur:
                cur.execute("SELECT table_name FROM information_schema.tables "
                            "WHERE table_schema='public' AND table_type='BASE TABLE'")
                return cur.fetchall()
        return [r["table_name"] for r in self._run(go)]

    def _init_defaults(self):
        with self._conn.cursor() as cur:
            for k, v in config.DEFAULT_SETTINGS.items():
                cur.execute("INSERT INTO settings(key,value) VALUES(%s,%s) ON CONFLICT (key) DO NOTHING",
                            (k, v))
            if cur.execute("SELECT 1 FROM instructions LIMIT 1").fetchone() is None:
                cur.execute("INSERT INTO instructions(version,fields,note,created_at) VALUES(1,%s,%s,%s)",
                            (json.dumps(config.DEFAULT_INSTRUCTIONS), "Default instruction set", int(time.time())))
                cur.execute("INSERT INTO settings(key,value) VALUES('active_instruction_version','1') "
                            "ON CONFLICT (key) DO UPDATE SET value = excluded.value")
            if cur.execute("SELECT 1 FROM tools_registry LIMIT 1").fetchone() is None:
                for t in config.TOOL_SEEDS:
                    cur.execute(
                        "INSERT INTO tools_registry(name,description,params,enabled,built_in) "
                        "VALUES(%s,%s,%s,%s,%s) ON CONFLICT (name) DO NOTHING", t)

    def describe(self) -> dict:
        d = {"kind": "postgres", "persistent": True}
        try:
            u = urlparse(config.DATABASE_URL)
            host = u.hostname or ""
            if u.port:
                host += f":{u.port}"
            d["host"] = host
            d["database"] = (u.path or "").lstrip("/")
        except Exception:
            pass
        return d
