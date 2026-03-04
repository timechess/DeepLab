from __future__ import annotations

from typing import Any

from deeplab.db.engine import execute, executemany, fetch_all, fetch_one


__all__ = [
    "delete_rows",
    "execute",
    "executemany",
    "fetch_all",
    "fetch_one",
]


def delete_rows(sql: str, params: tuple[Any, ...] | list[Any] | None = None) -> int:
    return execute(sql, params)
