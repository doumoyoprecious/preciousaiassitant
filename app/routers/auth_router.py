"""Setup / login / logout / me."""
import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .. import auth, db

router = APIRouter(prefix="/api", tags=["auth"])


class SetupIn(BaseModel):
    username: str = Field(default="owner", min_length=2, max_length=32)
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    username: str
    password: str


@router.get("/me")
def me(request: Request):
    owner = db.query_one("SELECT id, username, role FROM owner LIMIT 1")
    user = auth.get_current_user(request)
    return {
        "has_owner": bool(owner),
        "owner_username": owner["username"] if owner else None,
        "user": {"username": user["username"], "role": user["role"]} if user else None,
    }


@router.post("/setup")
def setup(body: SetupIn, request: Request, response: Response):
    if db.query_one("SELECT id FROM owner LIMIT 1"):
        raise HTTPException(400, "This instance is already configured. Log in instead.")
    username = body.username.strip().lower()
    if not re.match(r"^[a-z0-9_\-\.]{2,32}$", username):
        raise HTTPException(400, "Username must be 2-32 characters (letters, numbers, _ - .).")
    db.execute(
        "INSERT INTO owner(username, pass_hash, role, created_at) VALUES(?,?,?,?)",
        (username, auth.hash_password(body.password), "owner", db.now()))
    # portable across backends (no cursor.lastrowid)
    owner_id = db.query_one("SELECT id FROM owner WHERE username=?", (username,))["id"]
    token = auth.create_session(owner_id)
    auth.set_cookie(response, request, token)
    db.log_event("setup", detail={"username": username})
    return {"username": username, "role": "owner"}


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response):
    auth.rate_limit_login(request)
    owner = db.query_one("SELECT * FROM owner WHERE username=?", (body.username.strip().lower(),))
    if not owner or not auth.verify_password(body.password, owner["pass_hash"]):
        db.log_event("login_failed", detail={"username": body.username.strip()[:32]})
        raise HTTPException(401, "Invalid username or password.")
    token = auth.create_session(owner["id"])
    auth.set_cookie(response, request, token)
    db.log_event("login", detail={"username": owner["username"]})
    return {"username": owner["username"], "role": owner["role"]}


@router.post("/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get("pa_session")
    if token:
        db.execute("DELETE FROM sessions WHERE token=?", (token,))
    auth.clear_cookie(response)
    return {"ok": True}


@router.get("/whoami")
def whoami(user=Depends(auth.require_user)):
    return {"username": user["username"], "role": user["role"]}
