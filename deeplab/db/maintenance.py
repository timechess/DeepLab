from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import duckdb

logger = logging.getLogger(__name__)

_DEFAULT_DELAY_SECONDS = 45
_DEFAULT_MIN_DB_SIZE_MB = 64
_DEFAULT_MIN_INTERVAL_HOURS = 24


def _parse_positive_int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def _maintenance_marker_path(db_path: Path) -> Path:
    return db_path.parent / f"{db_path.name}.maintenance.json"


def _load_last_vacuum_at(marker_path: Path) -> datetime | None:
    if not marker_path.exists():
        return None
    try:
        payload = json.loads(marker_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    raw = str(payload.get("last_vacuum_at", "")).strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _write_maintenance_marker(marker_path: Path, db_size_bytes: int) -> None:
    payload = {
        "last_vacuum_at": datetime.now(tz=UTC).isoformat(),
        "database_size_bytes": db_size_bytes,
    }
    marker_path.parent.mkdir(parents=True, exist_ok=True)
    marker_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _should_run_vacuum(db_path: Path) -> tuple[bool, str]:
    if not db_path.exists():
        return False, "database file not found"

    min_db_size_mb = _parse_positive_int_env(
        "DEEPLAB_DB_VACUUM_MIN_SIZE_MB",
        _DEFAULT_MIN_DB_SIZE_MB,
    )
    min_interval_hours = _parse_positive_int_env(
        "DEEPLAB_DB_VACUUM_MIN_INTERVAL_HOURS",
        _DEFAULT_MIN_INTERVAL_HOURS,
    )
    min_db_size_bytes = min_db_size_mb * 1024 * 1024

    db_size_bytes = db_path.stat().st_size
    if db_size_bytes < min_db_size_bytes:
        return False, f"database size {db_size_bytes} below threshold {min_db_size_bytes}"

    marker_path = _maintenance_marker_path(db_path)
    last_vacuum_at = _load_last_vacuum_at(marker_path)
    if last_vacuum_at is None:
        return True, "no previous vacuum marker"

    next_allowed = last_vacuum_at + timedelta(hours=min_interval_hours)
    now = datetime.now(tz=UTC)
    if now < next_allowed:
        return False, f"last vacuum at {last_vacuum_at.isoformat()}"

    return True, f"last vacuum at {last_vacuum_at.isoformat()}"


def _run_vacuum_sync(db_path: Path) -> None:
    con = duckdb.connect(str(db_path), read_only=False)
    try:
        con.execute("PRAGMA enable_object_cache=true;")
        con.execute("CHECKPOINT;")
        con.execute("VACUUM;")
    finally:
        con.close()

    new_size_bytes = db_path.stat().st_size if db_path.exists() else 0
    _write_maintenance_marker(_maintenance_marker_path(db_path), new_size_bytes)


async def run_startup_db_maintenance(db_path: Path) -> None:
    delay_seconds = _parse_positive_int_env(
        "DEEPLAB_DB_VACUUM_DELAY_SECONDS",
        _DEFAULT_DELAY_SECONDS,
    )
    await asyncio.sleep(delay_seconds)

    should_run, reason = _should_run_vacuum(db_path)
    if not should_run:
        logger.info("Database maintenance skipped: %s", reason)
        return

    logger.info("Database maintenance started: %s", reason)
    try:
        await asyncio.to_thread(_run_vacuum_sync, db_path)
    except Exception:
        logger.exception("Database maintenance failed")
        return

    logger.info("Database maintenance completed")

