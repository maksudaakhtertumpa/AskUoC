"""Authentication service: one login for everyone, the role comes from the account (no "I'm an admin" choice)."""

from __future__ import annotations

import hmac
import os
from dataclasses import dataclass

from app.accounts import ROLE_RANK, Account, AccountStore
from app.cache import Cache
from app.config import Settings
from app.security import hash_password, make_token, normalize_username, read_token, validate_password, verify_password

USER_TTL = 30 * 24 * 3600
STAFF_TTL = 12 * 3600
MAX_FAILS = 8  # wrong passwords per account per window before it is locked out
FAIL_WINDOW = 15 * 60

# Precomputed so a login for a non-existent user costs the same as a real one (no user enumeration by timing).
_DUMMY_HASH = hash_password("dummy-password-for-timing")


class AuthError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status, self.message = status, message


@dataclass
class Principal:
    username: str
    role: str
    display_name: str = ""

    def at_least(self, role: str) -> bool:
        return ROLE_RANK[self.role] >= ROLE_RANK[role]


class AuthService:
    def __init__(self, settings: Settings, accounts: AccountStore, cache: Cache) -> None:
        self.s, self.accounts, self.cache = settings, accounts, cache
        # without SECRET_KEY/ADMIN_TOKEN the secret is random, so sessions reset on restart
        self.secret = settings.secret_key or settings.admin_token or os.urandom(32).hex()

    def issue(self, acc: Account) -> str:
        ttl = USER_TTL if acc.role == "user" else STAFF_TTL
        return make_token(self.secret, {"u": acc.username, "pwv": acc.pwv}, ttl)

    async def verify(self, token: str) -> Principal | None:
        payload = read_token(self.secret, token)
        if not payload:
            return None
        acc = await self.accounts.get(payload.get("u", ""))
        if not acc or acc.disabled or acc.pwv != payload.get("pwv"):
            return None  # deleted, disabled, or password changed since issue
        return Principal(acc.username, acc.role, acc.display_name or acc.username)

    def break_glass(self, token: str | None) -> Principal | None:
        """ADMIN_TOKEN: a deployment-level key for automation (Prometheus, scripts) - acts as an admin."""
        if token and self.s.admin_token and hmac.compare_digest(token, self.s.admin_token):
            return Principal("admin-token", "admin", "Admin token")
        return None

    async def status(self) -> dict:
        admins = await self.accounts.count_role("admin")
        return {
            "signup": self.s.allow_signup,
            "admin_console": bool(self.s.admin_token),
            "needs_setup": bool(self.s.admin_token) and admins == 0,
        }

    async def _create(self, username: str, password: str, role: str, display_name: str = "") -> Account:
        try:
            username, password = normalize_username(username), validate_password(password)
        except ValueError as e:
            raise AuthError(422, str(e)) from e
        acc = Account(
            username=username, password_hash=hash_password(password), role=role, display_name=display_name.strip()[:60]
        )
        if not await self.accounts.create(acc):
            raise AuthError(409, "That username is taken.")
        return acc

    async def register(self, username: str, password: str, display_name: str = "") -> tuple[Account, str]:
        if not self.s.allow_signup:
            raise AuthError(403, "Sign-ups are disabled.")
        acc = await self._create(username, password, "user", display_name)
        return acc, self.issue(acc)

    async def setup_first_admin(self, setup_key: str, username: str, password: str) -> tuple[Account, str]:
        if not self.s.admin_token:
            raise AuthError(404, "Admin console is not enabled (set ADMIN_TOKEN).")
        if await self.accounts.count_role("admin") > 0:
            raise AuthError(409, "An admin already exists.")
        if not hmac.compare_digest(setup_key, self.s.admin_token):
            raise AuthError(401, "Wrong setup key.")
        acc = await self._create(username, password, "admin")
        return acc, self.issue(acc)

    async def login(self, username: str, password: str) -> tuple[Account, str]:
        try:
            username = normalize_username(username)
        except ValueError:
            username = "-invalid-"
        lock_key = f"loginfail:{username}"
        if await self.cache.count(lock_key) >= MAX_FAILS:  # locked: even the right password is refused
            raise AuthError(429, "Too many failed attempts - try again in 15 minutes.")
        acc = await self.accounts.get(username)
        ok = verify_password(password, acc.password_hash if acc else _DUMMY_HASH)
        if not (acc and ok and not acc.disabled):
            await self.cache.incr(lock_key, FAIL_WINDOW)
            raise AuthError(401, "Wrong username or password.")
        return acc, self.issue(acc)

    async def change_password(self, principal: Principal, current: str, new: str) -> str:
        acc = await self.accounts.get(principal.username)
        if not acc or not verify_password(current, acc.password_hash):
            raise AuthError(401, "Current password is wrong.")
        try:
            validate_password(new)
        except ValueError as e:
            raise AuthError(422, str(e)) from e
        updated = await self.accounts.update(acc.username, password_hash=hash_password(new), pwv=acc.pwv + 1)
        assert updated
        return self.issue(updated)  # other sessions are now invalid; this one continues
