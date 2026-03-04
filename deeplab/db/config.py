from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DuckDBConfig:
    path: Path
    read_only: bool = False


def _parse_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return default


def load_duckdb_config() -> DuckDBConfig:
    raw_path = os.getenv("DEEPLAB_DB_PATH", "persist/deeplab.duckdb").strip()
    db_path = Path(raw_path)
    if not db_path.is_absolute():
        db_path = Path.cwd() / db_path

    read_only = _parse_bool(os.getenv("DEEPLAB_DB_READ_ONLY"), default=False)
    return DuckDBConfig(path=db_path, read_only=read_only)
