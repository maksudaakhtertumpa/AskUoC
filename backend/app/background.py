"""Periodic maintenance: retention purges and scheduled snapshots. Runs inside the API process (one small loop)."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

log = logging.getLogger("askuoc.maintenance")
AUDIT_RETENTION_DAYS = 365


async def run_once(st) -> dict:
    """One maintenance pass. Every step is independent and failure-isolated."""
    done: dict = {}
    s = st.settings
    try:
        if s.log_retention_days > 0:
            done["chat_logs_purged"] = await st.storage.purge_chat_logs(s.log_retention_days)
        done["audit_purged"] = await st.storage.purge_audit(AUDIT_RETENTION_DAYS)
        done["shares_purged"] = await st.storage.purge_shares()
    except Exception:  # noqa: BLE001
        log.exception("retention purge failed")
    try:
        if s.auto_snapshot_hours > 0 and st.snapshots is not None:
            metas = await st.snapshots.list()
            newest = metas[0] if metas else None
            changed = newest is None or newest.get("data_version") != st.data_version
            due = newest is None or datetime.fromisoformat(newest["created_at"]) < datetime.now(UTC) - timedelta(
                hours=s.auto_snapshot_hours
            )
            if changed and due and await st.store.count() > 0:
                snap = await st.snapshots.create(kind="auto", name="Scheduled snapshot", actor="system")
                done["snapshot"] = snap["id"]
    except Exception:  # noqa: BLE001
        log.exception("scheduled snapshot failed")
    if any(done.values()):
        log.info("maintenance", extra={k: v for k, v in done.items()})
    return done


async def maintenance_loop(st, first_delay: float = 90, interval: float = 6 * 3600) -> None:
    await asyncio.sleep(first_delay)
    while True:
        await run_once(st)
        await asyncio.sleep(interval)
