from __future__ import annotations

import argparse
from pathlib import Path

import duckdb

from deeplab.db.config import load_duckdb_config


def _resolve_db_path(raw_path: str | None) -> Path:
    if raw_path and raw_path.strip():
        return Path(raw_path.strip()).expanduser().resolve()
    return load_duckdb_config().path.resolve()


def _format_size(num_bytes: int) -> str:
    value = float(num_bytes)
    units = ["B", "KB", "MB", "GB", "TB"]
    unit_idx = 0
    while value >= 1024 and unit_idx < len(units) - 1:
        value /= 1024
        unit_idx += 1
    return f"{value:.2f} {units[unit_idx]}"


def run_vacuum(db_path: Path) -> None:
    if not db_path.exists():
        raise FileNotFoundError(f"Database file not found: {db_path}")

    before_size = db_path.stat().st_size
    print(f"[vacuum] database: {db_path}")
    print(f"[vacuum] size before: {_format_size(before_size)} ({before_size} bytes)")

    con = duckdb.connect(str(db_path), read_only=False)
    try:
        con.execute("PRAGMA enable_object_cache=true;")
        con.execute("CHECKPOINT;")
        con.execute("VACUUM;")
    finally:
        con.close()

    after_size = db_path.stat().st_size
    reclaimed = max(0, before_size - after_size)
    print(f"[vacuum] size after: {_format_size(after_size)} ({after_size} bytes)")
    print(f"[vacuum] reclaimed: {_format_size(reclaimed)} ({reclaimed} bytes)")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run CHECKPOINT + VACUUM for DeepLab DuckDB.")
    parser.add_argument(
        "--db-path",
        default=None,
        help="Path to deeplab.duckdb (default: load from DEEPLAB_DB_PATH/config).",
    )
    args = parser.parse_args()

    db_path = _resolve_db_path(args.db_path)
    run_vacuum(db_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

