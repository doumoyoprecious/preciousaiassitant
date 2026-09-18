"""Persistence facade — delegates to the active storage provider.

Backends (see app/storage/, selected by PA_STORAGE):
    sqlite   (default)  -> file DB at PA_DATA_DIR (or /tmp on Vercel = ephemeral)
    postgres           -> external Postgres via PA_DATABASE_URL (persistent)

Call sites keep using this module unchanged:
    db.query / db.query_one / db.execute / db.executemany /
    db.get_setting / db.set_setting / db.all_settings /
    db.log_error / db.log_event / db.new_id / db.now / db.provider()

SQL is written in the SQLite dialect; the postgres provider translates it
transparently.
"""
import json
import time
import uuid

from .storage import get_provider


def provider():
    return get_provider()


def query(sql, args=()):
    return provider().query(sql, args)


def query_one(sql, args=()):
    return provider().query_one(sql, args)


def execute(sql, args=()):
    return provider().execute(sql, args)


def executemany(sql, seq):
    return provider().executemany(sql, seq)


def list_tables():
    return provider().list_tables()


def new_id():
    return uuid.uuid4().hex


def now():
    return int(time.time())


# ---------- settings ----------

def get_setting(key, default=None):
    row = query_one("SELECT value FROM settings WHERE key=?", (key,))
    return row["value"] if row else default


def set_setting(key, value):
    execute("INSERT INTO settings(key,value) VALUES(?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, str(value)))


def all_settings():
    return {r["key"]: r["value"] for r in query("SELECT key, value FROM settings")}


# ---------- logging / events ----------

def log_error(area, message, level="error", detail=None):
    try:
        execute("INSERT INTO error_logs(level,area,message,detail,created_at) VALUES(?,?,?,?,?)",
                (level, area, str(message)[:500], str(detail or "")[:4000], now()))
    except Exception:
        pass


def log_event(type_, conv_id=None, detail=None):
    try:
        execute("INSERT INTO chat_events(type,conv_id,detail,created_at) VALUES(?,?,?,?)",
                (type_, conv_id, json.dumps(detail) if isinstance(detail, (dict, list)) else detail, now()))
    except Exception:
        pass
