"""SQLite storage provider (default backend).

File database at config.DB_PATH:
  * dev box / small API server  -> <project>/data (persistent disk)
  * Vercel serverless           -> /tmp/precious-ai (EPHEMERAL)
"""
import json
import sqlite3
import threading
import time

from .. import config
from .base import StorageProvider

SCHEMA = """
CREATE TABLE IF NOT EXISTS owner(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
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
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conv_id, created_at);
CREATE TABLE IF NOT EXISTS documents(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General Knowledge',
  source_type TEXT NOT NULL DEFAULT 'upload',
  file_path TEXT,
  content_hash TEXT,
  size_bytes INTEGER,
  pages INTEGER,
  chunks INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  is_authoritative INTEGER NOT NULL DEFAULT 0,
  is_outdated INTEGER NOT NULL DEFAULT 0,
  preview TEXT,
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
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
  embedding BLOB NOT NULL
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
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS suggestions(
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fact',
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'chat',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS feedback(
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  conv_id TEXT,
  rating TEXT NOT NULL,
  note TEXT,
  corrected_answer TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS instructions(
  version INTEGER PRIMARY KEY,
  fields TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS api_keys(provider TEXT PRIMARY KEY, key TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS error_logs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  area TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_cases(
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  expected_behavior TEXT,
  expected_info TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_runs(
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT,
  error TEXT,
  score REAL,
  expected_hits TEXT,
  retrieval TEXT,
  passed INTEGER,
  flags TEXT,
  notes TEXT,
  model TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  conv_id TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tools_registry(
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  params TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  built_in INTEGER NOT NULL DEFAULT 1
);
"""


class SQLiteProvider(StorageProvider):
    kind = "sqlite"

    def __init__(self):
        # sqlite in /tmp (Vercel) does not survive instance recycling.
        self.persistent = not config.IS_SERVERLESS
        self._conn = None
        self._lock = threading.Lock()

    def init(self):
        if self._conn is not None:
            return
        config.ensure_dirs()
        try:
            self._conn = sqlite3.connect(str(config.DB_PATH), check_same_thread=False)
        except sqlite3.Error as e:
            raise RuntimeError(f"Cannot open SQLite database at {config.DB_PATH}: {e}") from e
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(SCHEMA)
        self._init_defaults()
        self._conn.commit()

    def _init_defaults(self):
        c = self._conn
        for k, v in config.DEFAULT_SETTINGS.items():
            c.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", (k, v))
        if not c.execute("SELECT 1 FROM instructions LIMIT 1").fetchone():
            c.execute("INSERT INTO instructions(version,fields,note,created_at) VALUES(1,?,?,?)",
                      (json.dumps(config.DEFAULT_INSTRUCTIONS), "Default instruction set", int(time.time())))
            c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('active_instruction_version','1')")
        if not c.execute("SELECT 1 FROM tools_registry LIMIT 1").fetchone():
            for t in config.TOOL_SEEDS:
                c.execute("INSERT OR IGNORE INTO tools_registry(name,description,params,enabled,built_in) VALUES(?,?,?,?,?)", t)

    def query(self, sql, args=()):
        self.init()
        with self._lock:
            cur = self._conn.execute(sql, args)
            return [dict(r) for r in cur.fetchall()]

    def query_one(self, sql, args=()):
        rows = self.query(sql, args)
        return rows[0] if rows else None

    def execute(self, sql, args=()):
        self.init()
        with self._lock:
            cur = self._conn.execute(sql, args)
            self._conn.commit()
            return cur

    def executemany(self, sql, seq):
        self.init()
        with self._lock:
            self._conn.executemany(sql, list(seq))
            self._conn.commit()

    def list_tables(self) -> list:
        self.init()
        with self._lock:
            rows = self._conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        return [r["name"] for r in rows if not r["name"].startswith("sqlite_")]

    def describe(self) -> dict:
        d = {
            "kind": "sqlite",
            "path": str(config.DB_PATH),
            "persistent": self.persistent,
        }
        if not self.persistent:
            d["warning"] = (
                "Ephemeral storage: this SQLite database lives in /tmp on Vercel and is "
                "LOST when the function instance is recycled (minutes of inactivity, new "
                "deployment, region switch). Set PA_STORAGE=postgres + PA_DATABASE_URL for "
                "durable data."
            )
        return d
