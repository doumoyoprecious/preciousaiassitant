"""Authentication: owner setup, login, session cookies, authorization deps."""
import hashlib
import hmac
import secrets
import time

from fastapi import Depends, HTTPException, Request, Response

from . import db

SESSION_TTL = 7 * 86400


def hash_password(pw: str, salt: str = None) -> str:
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 200_000).hex()
    return f"{salt}${h}"


def verify_password(pw: str, stored: str) -> bool:
    salt, _, h = stored.partition("$")
    if not salt or not h:
        return False
    return hmac.compare_digest(hash_password(pw, salt), stored)


def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    db.execute("INSERT INTO sessions(token,user_id,expires_at,created_at) VALUES(?,?,?,?)",
               (token, user_id, int(time.time()) + SESSION_TTL, db.now()))
    return token


def _is_secure(request: Request) -> bool:
    return request.headers.get("x-forwarded-proto") == "https" or request.url.scheme == "https"


def set_cookie(response: Response, request: Request, token: str):
    response.set_cookie(
        "pa_session", token, httponly=True, samesite="lax",
        max_age=SESSION_TTL, secure=_is_secure(request), path="/",
    )


def clear_cookie(response: Response):
    response.delete_cookie("pa_session")


def get_current_user(request: Request):
    token = request.cookies.get("pa_session")
    if not token:
        return None
    row = db.query_one(
        "SELECT s.token AS token, s.expires_at AS expires_at, o.id AS user_id, o.username, o.role "
        "FROM sessions s JOIN owner o ON o.id=s.user_id WHERE s.token=?", (token,))
    if not row or row["expires_at"] < time.time():
        db.execute("DELETE FROM sessions WHERE token=?", (token,))
        return None
    return row


def require_user(user=Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated. Please log in.")
    return user


def require_owner(user=Depends(require_user)):
    if user["role"] != "owner":
        raise HTTPException(status_code=403, detail="Owner access required.")
    return user


# Simple in-memory login rate limit: 8 attempts / 60s / IP.
_attempts = {}


def rate_limit_login(request: Request):
    ip = request.client.host if request.client else "unknown"
    bucket = int(time.time() // 60)
    rec = _attempts.get(ip, (bucket, 0))
    count = rec[1] if rec[0] == bucket else 0
    if count >= 8:
        raise HTTPException(status_code=429, detail="Too many login attempts. Wait a minute and try again.")
    _attempts[ip] = (bucket, count + 1)
