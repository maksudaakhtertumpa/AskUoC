"""Tiny key/value store (JSON document per key) for runtime settings and index metadata."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Protocol


class KV(Protocol):
    async def get(self, key: str) -> dict | None: ...
    async def set(self, key: str, value: dict) -> None: ...


class JsonKV:
    def __init__(self, path: Path) -> None:
        self.path, self._lock = path, asyncio.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _load(self) -> dict:
        return json.loads(self.path.read_text()) if self.path.exists() else {}

    async def get(self, key: str) -> dict | None:
        return self._load().get(key)

    async def set(self, key: str, value: dict) -> None:
        async with self._lock:
            data = self._load()
            data[key] = value
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, indent=1))
            os.replace(tmp, self.path)


class PgKV:
    def __init__(self, pool) -> None:
        self.pool = pool

    async def get(self, key: str) -> dict | None:
        async with self.pool.connection() as c:
            r = await (await c.execute("select value from app_kv where key = %s", (key,))).fetchone()
        return r["value"] if r else None

    async def set(self, key: str, value: dict) -> None:
        async with self.pool.connection() as c:
            await c.execute(
                "insert into app_kv (key, value, updated_at) values (%s, %s::jsonb, now()) "
                "on conflict (key) do update set value = excluded.value, updated_at = now()",
                (key, json.dumps(value)),
            )
