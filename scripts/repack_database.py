from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
import shutil

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


def _timestamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def _copy_database_logically(src: Path, dst: Path) -> None:
    con = duckdb.connect(str(src), read_only=False)
    try:
        db_name = con.execute("PRAGMA database_list").fetchone()[1]
        con.execute(f"ATTACH '{dst.as_posix()}' AS repack")
        con.execute(f"COPY FROM DATABASE {db_name} TO repack")
        con.execute("DETACH repack")
    finally:
        con.close()


def repack_database(db_path: Path, backup: bool = True) -> None:
    if not db_path.exists():
        raise FileNotFoundError(f"Database file not found: {db_path}")

    before_size = db_path.stat().st_size
    print(f"[repack] database: {db_path}")
    print(f"[repack] size before: {_format_size(before_size)} ({before_size} bytes)")

    temp_path = db_path.with_name(f"{db_path.stem}.repack-{_timestamp()}.duckdb")
    backup_path = db_path.with_name(f"{db_path.stem}.backup-{_timestamp()}.duckdb")

    _copy_database_logically(db_path, temp_path)
    temp_size = temp_path.stat().st_size
    print(f"[repack] rebuilt file: {temp_path.name} ({_format_size(temp_size)})")

    if backup:
        shutil.copy2(db_path, backup_path)
        print(f"[repack] backup created: {backup_path}")

    db_path.unlink()
    temp_path.replace(db_path)

    after_size = db_path.stat().st_size
    reclaimed = max(0, before_size - after_size)
    print(f"[repack] size after: {_format_size(after_size)} ({after_size} bytes)")
    print(f"[repack] reclaimed: {_format_size(reclaimed)} ({reclaimed} bytes)")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Repack DuckDB by logical copy (effective when VACUUM does not shrink file)."
    )
    parser.add_argument(
        "--db-path",
        default=None,
        help="Path to deeplab.duckdb (default: load from DEEPLAB_DB_PATH/config).",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Do not create a backup copy before replacing the original database.",
    )
    args = parser.parse_args()

    db_path = _resolve_db_path(args.db_path)
    repack_database(db_path, backup=not args.no_backup)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

