"""Security primitives: scrypt passwords, HMAC-signed session tokens and Fernet-encrypted secrets at rest."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time

from cryptography.fernet import Fernet, InvalidToken

_USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**14, 8, 1


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def normalize_username(u: str) -> str:
    u = u.strip().lower()
    if not _USERNAME_RE.match(u):
        raise ValueError("Username must be 3-32 characters: letters, numbers, dots, dashes or underscores.")
    return u


def validate_password(p: str) -> str:
    if not 10 <= len(p) <= 128:
        raise ValueError("Password must be 10-128 characters.")
    if p.lower() in {"password123", "1234567890", "qwertyuiop", "0123456789"}:
        raise ValueError("That password is too common - please choose another.")
    return p


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(salt)}${_b64(dk)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, dk = stored.split("$")
        got = hashlib.scrypt(password.encode(), salt=_unb64(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(got, _unb64(dk))
    except Exception:  # noqa: BLE001 - malformed hash = no match
        return False


def make_token(secret: str, payload: dict, ttl: int) -> str:
    body = _b64(json.dumps({**payload, "exp": int(time.time()) + ttl}, separators=(",", ":")).encode())
    sig = _b64(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def read_token(secret: str, token: str) -> dict | None:
    try:
        body, sig = token.split(".")
        want = _b64(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, want):
            return None
        payload = json.loads(_unb64(body))
        return payload if payload.get("exp", 0) > time.time() else None
    except Exception:  # noqa: BLE001
        return None


class SecretBox:
    """Encrypt/decrypt small secrets (API keys). Values look like `enc:v1:<token>`."""

    PREFIX = "enc:v1:"

    def __init__(self, secret: str) -> None:
        key = hashlib.sha256(f"askuoc-secretbox:{secret}".encode()).digest()
        self._f = Fernet(base64.urlsafe_b64encode(key))

    def encrypt(self, plain: str) -> str:
        return self.PREFIX + self._f.encrypt(plain.encode()).decode()

    def decrypt(self, value: str) -> str | None:
        if not value.startswith(self.PREFIX):
            return value  # legacy/plain
        try:
            return self._f.decrypt(value[len(self.PREFIX) :].encode()).decode()
        except InvalidToken:
            return None  # server secret changed: the stored key can't be recovered

    @staticmethod
    def mask(plain: str) -> str:
        return "••••" + plain[-4:] if len(plain) > 8 else "••••"


MIN_SECRET_CHARS = 32
MIN_TOKEN_CHARS = 16


def weak_secrets(secret_key: str | None, admin_token: str | None) -> list[str]:
    """Problems with the two long-lived secrets; both should be random strings from `secrets.token_urlsafe(48)`."""
    problems = []
    if secret_key and len(secret_key) < MIN_SECRET_CHARS:
        problems.append(f"SECRET_KEY is {len(secret_key)} characters; use at least {MIN_SECRET_CHARS}")
    if admin_token and len(admin_token) < MIN_TOKEN_CHARS:
        problems.append(f"ADMIN_TOKEN is {len(admin_token)} characters; use at least {MIN_TOKEN_CHARS}")
    if secret_key and secret_key == admin_token:
        problems.append("SECRET_KEY and ADMIN_TOKEN must be different values")
    return problems
