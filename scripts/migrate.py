"""Apply supabase/migrations/*.sql once each, recording checksums; an edited applied migration aborts.

python scripts/migrate.py [--url postgresql://...] [--dry-run]    # url defaults to $DATABASE_URL or .env
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from pathlib import Path

import psycopg

MIGRATIONS = Path(__file__).resolve().parents[1] / "supabase" / "migrations"


def apply(url: str, dry_run: bool = False, directory: Path = MIGRATIONS) -> list[str]:
    files = sorted(directory.glob("*.sql"))
    applied_now: list[str] = []
    with psycopg.connect(url, autocommit=True, prepare_threshold=None) as conn:
        conn.execute(
            "create table if not exists schema_migrations (version text primary key, checksum text not null, applied_at timestamptz not null default now())"
        )
        done = dict(conn.execute("select version, checksum from schema_migrations").fetchall())
        for f in files:
            sql = f.read_text()
            checksum = hashlib.sha256(sql.encode()).hexdigest()
            if f.name in done:
                if done[f.name] != checksum:
                    raise SystemExit(f"Migration {f.name} was edited after being applied. Add a new migration instead.")
                continue
            print(f"{'would apply' if dry_run else 'applying'} {f.name}")
            if not dry_run:
                with conn.transaction():
                    conn.execute(sql)
                    conn.execute(
                        "insert into schema_migrations (version, checksum) values (%s, %s)", (f.name, checksum)
                    )
            applied_now.append(f.name)
    return applied_now


def default_url() -> str | None:
    """$DATABASE_URL, else the value in the repo's .env."""
    if os.getenv("DATABASE_URL"):
        return os.getenv("DATABASE_URL")
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
    from app.config import get_settings

    return get_settings().database_url or None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=default_url())
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if not a.url:
        sys.exit("Set DATABASE_URL or pass --url")
    done = apply(a.url, a.dry_run)
    print(
        f"{len(done)} migration(s) {'pending' if a.dry_run else 'applied'}; database is up to date."
        if done
        else "Database already up to date."
    )


if __name__ == "__main__":
    main()
