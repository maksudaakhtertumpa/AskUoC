"""Account storage (JSON file for dev, Postgres for prod); roles are user < staff < admin."""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

ROLES = ("user", "staff", "admin")
ROLE_RANK = {r: i for i, r in enumerate(ROLES)}


def _now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class Account:
    username: str
    password_hash: str
    role: str = "user"
    display_name: str = ""
    avatar: str = ""  # small data URL, optional
    disabled: bool = False
    pwv: int = 1  # password version: bumping it invalidates all existing sessions
    created_at: str = field(default_factory=_now)

    def public(self) -> dict:
        return {
            "username": self.username,
            "role": self.role,
            "display_name": self.display_name or self.username,
            "has_avatar": bool(self.avatar),
            "disabled": self.disabled,
            "created_at": self.created_at,
        }


class AccountStore(Protocol):
    async def count(self) -> int: ...
    async def count_role(self, role: str) -> int: ...
    async def get(self, username: str) -> Account | None: ...
    async def create(self, acc: Account) -> bool: ...  # False if the username is taken
    async def update(self, username: str, **fields) -> Account | None: ...
    async def delete(self, username: str) -> bool: ...
    async def list(self) -> list[Account]: ...


class JsonAccounts:
    """File-backed store for local development (atomic writes, single process)."""

    def __init__(self, path: Path) -> None:
        self.path, self._lock = path, asyncio.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _load(self) -> dict[str, dict]:
        return json.loads(self.path.read_text()) if self.path.exists() else {}

    def _save(self, data: dict) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=1))
        os.replace(tmp, self.path)

    async def count(self) -> int:
        return len(self._load())

    async def count_role(self, role: str) -> int:
        return sum(1 for a in self._load().values() if a["role"] == role and not a["disabled"])

    async def get(self, username: str) -> Account | None:
        row = self._load().get(username)
        return Account(**row) if row else None

    async def create(self, acc: Account) -> bool:
        async with self._lock:
            data = self._load()
            if acc.username in data:
                return False
            data[acc.username] = asdict(acc)
            self._save(data)
            return True

    async def update(self, username: str, **fields) -> Account | None:
        async with self._lock:
            data = self._load()
            if username not in data:
                return None
            data[username].update(fields)
            self._save(data)
            return Account(**data[username])

    async def delete(self, username: str) -> bool:
        async with self._lock:
            data = self._load()
            if username not in data:
                return False
            del data[username]
            self._save(data)
            return True

    async def list(self) -> list[Account]:
        return sorted((Account(**a) for a in self._load().values()), key=lambda a: a.created_at)


class PgAccounts:
    def __init__(self, pool) -> None:
        self.pool = pool

    @staticmethod
    def _acc(r: dict) -> Account:
        return Account(
            username=r["username"],
            password_hash=r["password_hash"],
            role=r["role"],
            display_name=r["display_name"] or "",
            avatar=r["avatar"] or "",
            disabled=r["disabled"],
            pwv=r["pwv"],
            created_at=r["created_at"].isoformat(),
        )

    async def count(self) -> int:
        async with self.pool.connection() as c:
            return (await (await c.execute("select count(*) as n from accounts")).fetchone())["n"]

    async def count_role(self, role: str) -> int:
        async with self.pool.connection() as c:
            return (
                await (
                    await c.execute("select count(*) as n from accounts where role = %s and not disabled", (role,))
                ).fetchone()
            )["n"]

    async def get(self, username: str) -> Account | None:
        async with self.pool.connection() as c:
            r = await (await c.execute("select * from accounts where username = %s", (username,))).fetchone()
        return self._acc(r) if r else None

    async def create(self, acc: Account) -> bool:
        async with self.pool.connection() as c:
            cur = await c.execute(
                "insert into accounts (username, password_hash, role, display_name, avatar, disabled, pwv) values (%s,%s,%s,%s,%s,%s,%s) "
                "on conflict (username) do nothing",
                (acc.username, acc.password_hash, acc.role, acc.display_name, acc.avatar, acc.disabled, acc.pwv),
            )
            return cur.rowcount > 0

    async def update(self, username: str, **fields) -> Account | None:
        from psycopg import sql

        allowed = {"password_hash", "role", "display_name", "avatar", "disabled", "pwv"}
        sets = [k for k in fields if k in allowed]
        if not sets:
            return await self.get(username)
        async with self.pool.connection() as c:
            r = await (
                await c.execute(
                    sql.SQL("update accounts set {} where username = %s returning *").format(
                        sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(k)) for k in sets)
                    ),
                    (*[fields[k] for k in sets], username),
                )
            ).fetchone()
        return self._acc(r) if r else None

    async def delete(self, username: str) -> bool:
        async with self.pool.connection() as c:
            cur = await c.execute("delete from accounts where username = %s", (username,))
            return cur.rowcount > 0

    async def list(self) -> list[Account]:
        async with self.pool.connection() as c:
            rows = await (await c.execute("select * from accounts order by created_at")).fetchall()
        return [self._acc(r) for r in rows]
