"""Chat logging + feedback. Postgres in prod, JSONL locally. No IPs or PII are stored."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Protocol

SHARE_TTL_DAYS = 90
MAX_SYNCED = 200  # synced conversations kept per user


def new_share_id() -> str:
    return secrets.token_urlsafe(9)  # 72 bits: not guessable


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class ChatStorage(Protocol):
    async def log_chat(
        self,
        thread_id: str,
        question: str,
        answer: str,
        route: str,
        source_urls: list[str],
        latency_ms: int,
        cache: str | None = None,
    ) -> int: ...
    async def stats(self) -> dict: ...
    async def delete_user_data(self, username: str) -> None: ...
    async def list_user_conversations(self, username: str) -> list[dict]: ...
    async def upsert_user_conversations(self, username: str, items: list[dict]) -> int: ...
    async def delete_user_conversation(self, username: str, conv_id: str) -> bool: ...
    async def audit(self, actor: str, action: str, detail: dict) -> None: ...
    async def list_audit(self, limit: int = 100) -> list[dict]: ...
    async def purge_chat_logs(self, days: int) -> int: ...
    async def purge_audit(self, days: int) -> int: ...
    async def purge_shares(self) -> int: ...
    async def add_feedback(self, chat_id: int, rating: int, comment: str | None) -> None: ...
    async def create_share(self, snapshot: dict, delete_token: str) -> str: ...
    async def get_share(self, share_id: str) -> dict | None: ...
    async def delete_share(self, share_id: str, delete_token: str) -> bool: ...


class JsonlStorage:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    async def log_chat(self, thread_id, question, answer, route, source_urls, latency_ms, cache=None) -> int:
        chat_id = int(time.time() * 1000)
        rec = {
            "id": chat_id,
            "ts": datetime.now(UTC).isoformat(),
            "thread_id": thread_id,
            "question": question,
            "answer": answer,
            "route": route,
            "source_urls": source_urls,
            "latency_ms": latency_ms,
            "cache": cache,
        }
        with self.path.open("a") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        return chat_id

    async def add_feedback(self, chat_id, rating, comment) -> None:
        with self.path.open("a") as f:
            f.write(json.dumps({"feedback_for": chat_id, "rating": rating, "comment": comment}) + "\n")

    # synced conversations: signed-in users only, never exposed to staff
    @property
    def _convs_path(self) -> Path:
        return self.path.with_name("user_conversations.json")

    def _load_convs(self) -> dict:
        return json.loads(self._convs_path.read_text()) if self._convs_path.exists() else {}

    async def delete_user_data(self, username: str) -> None:
        data = self._load_convs()
        if data.pop(username, None) is not None:
            self._convs_path.write_text(json.dumps(data))

    async def list_user_conversations(self, username: str) -> list[dict]:
        return sorted(self._load_convs().get(username, {}).values(), key=lambda r: r["updated_at"], reverse=True)

    async def upsert_user_conversations(self, username: str, items: list[dict]) -> int:
        data = self._load_convs()
        mine = data.setdefault(username, {})
        for it in items:  # last write wins, by the client clock
            cur = mine.get(it["id"])
            if cur is None or it["updated_at"] >= cur["updated_at"]:
                mine[it["id"]] = it
        for old in sorted(mine.values(), key=lambda r: r["updated_at"])[:-MAX_SYNCED]:
            del mine[old["id"]]
        self._convs_path.write_text(json.dumps(data))
        return len(mine)

    async def delete_user_conversation(self, username: str, conv_id: str) -> bool:
        data = self._load_convs()
        if conv_id not in data.get(username, {}):
            return False
        del data[username][conv_id]
        self._convs_path.write_text(json.dumps(data))
        return True

    async def audit(self, actor: str, action: str, detail: dict) -> None:
        with self.path.with_name("audit.jsonl").open("a") as f:
            f.write(
                json.dumps({"ts": datetime.now(UTC).isoformat(), "actor": actor, "action": action, "detail": detail})
                + "\n"
            )

    async def purge_chat_logs(self, days: int) -> int:
        """Drop chats older than `days` and their feedback; returns how many chats were removed."""
        if not self.path.exists():
            return 0
        cutoff = datetime.now(UTC) - timedelta(days=days)
        keep, removed, dead_ids = [], 0, set()
        recs = [json.loads(l) for l in self.path.read_text().splitlines() if l.strip()]
        for r in recs:
            if "ts" in r and datetime.fromisoformat(r["ts"]) < cutoff:
                removed += 1
                dead_ids.add(r["id"])
        for r in recs:
            if ("ts" in r and r["id"] in dead_ids) or ("feedback_for" in r and r["feedback_for"] in dead_ids):
                continue
            keep.append(r)
        self.path.write_text("".join(json.dumps(r) + "\n" for r in keep))
        return removed

    async def purge_audit(self, days: int) -> int:
        p = self.path.with_name("audit.jsonl")
        if not p.exists():
            return 0
        cutoff = datetime.now(UTC) - timedelta(days=days)
        rows = [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
        keep = [r for r in rows if datetime.fromisoformat(r["ts"]) >= cutoff]
        p.write_text("".join(json.dumps(r) + "\n" for r in keep))
        return len(rows) - len(keep)

    async def purge_shares(self) -> int:
        shares, now = self._load_shares(), datetime.now(UTC)
        live = {k: v for k, v in shares.items() if datetime.fromisoformat(v["expires"]) >= now}
        if len(live) != len(shares):
            self._shares_path.write_text(json.dumps(live))
        return len(shares) - len(live)

    async def list_audit(self, limit: int = 100) -> list[dict]:
        p = self.path.with_name("audit.jsonl")
        lines = p.read_text().splitlines()[-limit:] if p.exists() else []
        return [json.loads(l) for l in reversed(lines)]

    async def stats(self) -> dict:
        from app.analytics import compute_stats

        rows, fb = [], []
        for line in self.path.read_text().splitlines() if self.path.exists() else []:
            rec = json.loads(line)
            if "feedback_for" in rec:
                fb.append({"chat_id": rec["feedback_for"], "rating": rec["rating"]})
            elif "ts" in rec:
                rows.append(rec)
        return compute_stats(rows, fb)

    # shared conversation snapshots (one JSON file)
    @property
    def _shares_path(self) -> Path:
        return self.path.with_name("shared_chats.json")

    def _load_shares(self) -> dict:
        p = self._shares_path
        return json.loads(p.read_text()) if p.exists() else {}

    async def create_share(self, snapshot: dict, delete_token: str) -> str:
        shares, share_id = self._load_shares(), new_share_id()
        expires = datetime.now(UTC) + timedelta(days=SHARE_TTL_DAYS)
        shares[share_id] = {
            "snapshot": snapshot,
            "hash": hash_token(delete_token),
            "expires": expires.isoformat(),
            "created_at": datetime.now(UTC).isoformat(),
        }
        self._shares_path.write_text(json.dumps(shares))
        return share_id

    async def get_share(self, share_id: str) -> dict | None:
        row = self._load_shares().get(share_id)
        if not row or datetime.fromisoformat(row["expires"]) < datetime.now(UTC):
            return None
        return {**row["snapshot"], "created_at": row["created_at"]}

    async def delete_share(self, share_id: str, delete_token: str) -> bool:
        shares = self._load_shares()
        row = shares.get(share_id)
        if not row or not hmac.compare_digest(row["hash"], hash_token(delete_token)):
            return False
        del shares[share_id]
        self._shares_path.write_text(json.dumps(shares))
        return True


class PgStorage:
    def __init__(self, pool):
        self.pool = pool

    async def log_chat(self, thread_id, question, answer, route, source_urls, latency_ms, cache=None) -> int:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "insert into chat_logs (thread_id, question, answer, route, source_urls, latency_ms, cache) "
                "values (%s, %s, %s, %s, %s, %s, %s) returning id",
                (thread_id, question, answer, route, source_urls, latency_ms, cache),
            )
            return (await cur.fetchone())["id"]

    async def delete_user_data(self, username: str) -> None:
        async with self.pool.connection() as conn:
            await conn.execute("delete from user_conversations where username = %s", (username,))

    async def list_user_conversations(self, username: str) -> list[dict]:
        async with self.pool.connection() as conn:
            rows = await (
                await conn.execute(
                    "select id, updated_at, data from user_conversations where username = %s order by updated_at desc",
                    (username,),
                )
            ).fetchall()
        return [{"id": r["id"], "updated_at": r["updated_at"], "data": r["data"]} for r in rows]

    async def upsert_user_conversations(self, username: str, items: list[dict]) -> int:
        async with self.pool.connection() as conn:
            async with conn.transaction():
                for it in items:
                    await conn.execute(
                        "insert into user_conversations (username, id, updated_at, data) values (%s, %s, %s, %s::jsonb) "
                        "on conflict (username, id) do update set data = excluded.data, updated_at = excluded.updated_at "
                        "where user_conversations.updated_at <= excluded.updated_at",
                        (username, it["id"], it["updated_at"], json.dumps(it["data"])),
                    )
                await conn.execute(
                    "delete from user_conversations where username = %s and id in "
                    "(select id from user_conversations where username = %s order by updated_at desc offset %s)",
                    (username, username, MAX_SYNCED),
                )
                return (
                    await (
                        await conn.execute(
                            "select count(*)::int as n from user_conversations where username = %s", (username,)
                        )
                    ).fetchone()
                )["n"]

    async def delete_user_conversation(self, username: str, conv_id: str) -> bool:
        async with self.pool.connection() as conn:
            return (
                await conn.execute(
                    "delete from user_conversations where username = %s and id = %s", (username, conv_id)
                )
            ).rowcount > 0

    async def audit(self, actor: str, action: str, detail: dict) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(
                "insert into audit_log (actor, action, detail) values (%s, %s, %s::jsonb)",
                (actor, action, json.dumps(detail)),
            )

    async def list_audit(self, limit: int = 100) -> list[dict]:
        async with self.pool.connection() as conn:
            rows = await (
                await conn.execute(
                    "select created_at, actor, action, detail from audit_log order by id desc limit %s", (limit,)
                )
            ).fetchall()
        return [
            {"ts": r["created_at"].isoformat(), "actor": r["actor"], "action": r["action"], "detail": r["detail"]}
            for r in rows
        ]

    async def purge_chat_logs(self, days: int) -> int:
        async with self.pool.connection() as conn:  # feedback rows cascade (ON DELETE CASCADE)
            return (
                await conn.execute(
                    "delete from chat_logs where created_at < now() - make_interval(days => %s)", (days,)
                )
            ).rowcount

    async def purge_audit(self, days: int) -> int:
        async with self.pool.connection() as conn:
            return (
                await conn.execute(
                    "delete from audit_log where created_at < now() - make_interval(days => %s)", (days,)
                )
            ).rowcount

    async def purge_shares(self) -> int:
        async with self.pool.connection() as conn:
            return (await conn.execute("delete from shared_chats where expires_at < now()")).rowcount

    async def stats(self) -> dict:
        from app.analytics import compute_stats

        async with self.pool.connection() as conn:
            rows = await (
                await conn.execute(
                    "select id, created_at, question, route, latency_ms, cache from chat_logs order by id desc limit 5000"
                )
            ).fetchall()
            fb = await (await conn.execute("select chat_log_id as chat_id, rating from feedback")).fetchall()
        return compute_stats([{**r, "ts": r["created_at"].isoformat()} for r in rows], fb)

    async def add_feedback(self, chat_id, rating, comment) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(
                "insert into feedback (chat_log_id, rating, comment) values (%s, %s, %s)", (chat_id, rating, comment)
            )

    async def create_share(self, snapshot, delete_token) -> str:
        share_id = new_share_id()
        async with self.pool.connection() as conn:
            await conn.execute(
                "insert into shared_chats (id, snapshot, delete_token_hash, expires_at) "
                "values (%s, %s::jsonb, %s, now() + make_interval(days => %s))",
                (share_id, json.dumps(snapshot), hash_token(delete_token), SHARE_TTL_DAYS),
            )
        return share_id

    async def get_share(self, share_id) -> dict | None:
        async with self.pool.connection() as conn:
            row = await (
                await conn.execute(
                    "select snapshot, created_at from shared_chats where id = %s and expires_at > now()", (share_id,)
                )
            ).fetchone()
        return {**row["snapshot"], "created_at": row["created_at"].isoformat()} if row else None

    async def delete_share(self, share_id, delete_token) -> bool:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "delete from shared_chats where id = %s and delete_token_hash = %s",
                (share_id, hash_token(delete_token)),
            )
            return cur.rowcount > 0
