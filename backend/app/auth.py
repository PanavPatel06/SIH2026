"""Auth — farmers log in with phone + PIN (no OTP: README §15 already
established SMS delivery can't be trusted here, so it can't gate login
either), officers with email + password. Both issue a signed bearer token.

Token signing uses PyJWT (HS256) rather than hand-rolled HMAC — auth is a
security path, and "never simplify away security measures" (project
working agreement) means using the audited library even though a minimal
signer is only ~20 lines. Password/PIN hashing uses stdlib hashlib.scrypt
(memory-hard, no extra dependency — the hashlib docs recommend it for
exactly this)."""
import hashlib
import hmac
import os
import secrets
import time
from collections import defaultdict

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from . import models
from .db import get_db

ENVIRONMENT = os.environ.get("ENVIRONMENT", "development")
SECRET_KEY = os.environ.get("SECRET_KEY", "")
if not SECRET_KEY:
    if ENVIRONMENT == "production":
        # A random per-process secret is actively wrong in production: every
        # worker process (uvicorn --workers N) would sign with a different
        # key, so a token issued by one worker would fail verification on
        # another — and every restart/redeploy invalidates every session.
        # Fail loudly at startup instead of silently shipping that.
        raise RuntimeError(
            "SECRET_KEY must be set when ENVIRONMENT=production "
            "(e.g. `export SECRET_KEY=$(openssl rand -hex 32)`)."
        )
    # ponytail: dev-only fallback so the API runs with zero setup. A fixed
    # default secret would let anyone forge tokens, so this is random per
    # process instead (tokens stop working across restarts) — fine for a
    # single-process local `uvicorn --reload`, wrong for anything else.
    SECRET_KEY = secrets.token_hex(32)
    print("⚠ SECRET_KEY not set — using a random per-process dev secret "
          "(sessions won't survive a restart). Set SECRET_KEY before deploying.")

FARMER_TOKEN_HOURS = 30 * 24   # rural users log in rarely — month-long session
OFFICER_TOKEN_HOURS = 12       # shared gate-side devices — shorter session

bearer_scheme = HTTPBearer(auto_error=False)

RATE_LIMIT_WINDOW_SECONDS = 15 * 60
RATE_LIMIT_MAX_ATTEMPTS = 5
_login_attempts: dict[str, list[float]] = defaultdict(list)


def check_login_rate_limit(key: str) -> None:
    """Brute-force defense for login — matters most for farmer PINs, which
    are only 4+ digits (10,000 combinations) by design, since PIN-not-OTP
    was the whole point (README §15). Keyed by the identifier being guessed
    (phone/email), not by IP, so it stops someone hammering one account
    regardless of which IP they attack from.
    ponytail: in-memory, per-process — resets on restart, doesn't share
    state across multiple workers/instances. Fine for a single-process pilot
    deployment; move to Redis (INCR + EXPIRE) if this ever runs with >1
    worker or behind a load balancer."""
    now = time.time()
    attempts = _login_attempts[key]
    attempts[:] = [t for t in attempts if now - t < RATE_LIMIT_WINDOW_SECONDS]
    if len(attempts) >= RATE_LIMIT_MAX_ATTEMPTS:
        raise HTTPException(429, "too many attempts — try again in 15 minutes")
    attempts.append(now)


def hash_secret(raw: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(raw.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"{salt.hex()}${digest.hex()}"


def verify_secret(raw: str, stored: str) -> bool:
    try:
        salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    digest = hashlib.scrypt(raw.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=32)
    return hmac.compare_digest(digest.hex(), digest_hex)


def make_token(sub: str, typ: str, hours: float, **extra) -> str:
    payload = {"sub": sub, "typ": typ, "exp": int(time.time() + hours * 3600), **extra}
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")


def _decode(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "invalid or expired token")


def get_current_farmer(
    creds: HTTPAuthorizationCredentials = Depends(bearer_scheme), db: Session = Depends(get_db)
) -> models.Farmer:
    if not creds:
        raise HTTPException(401, "login required")
    payload = _decode(creds.credentials)
    if payload.get("typ") != "farmer":
        raise HTTPException(401, "not a farmer token")
    farmer = db.get(models.Farmer, payload["sub"])
    if not farmer:
        raise HTTPException(401, "farmer account no longer exists")
    return farmer


def get_current_officer(
    creds: HTTPAuthorizationCredentials = Depends(bearer_scheme), db: Session = Depends(get_db)
) -> models.Officer:
    if not creds:
        raise HTTPException(401, "login required")
    payload = _decode(creds.credentials)
    if payload.get("typ") != "officer":
        raise HTTPException(401, "not an officer token")
    officer = db.get(models.Officer, payload["sub"])
    if not officer:
        raise HTTPException(401, "officer account no longer exists")
    return officer


def require_centre_access(officer: models.Officer, centre_id: str) -> None:
    """centre_id=None on the officer means district admin — any centre.
    Otherwise the officer may only act on their own centre."""
    if officer.centre_id and officer.centre_id != centre_id:
        raise HTTPException(403, "not authorised for this centre")
