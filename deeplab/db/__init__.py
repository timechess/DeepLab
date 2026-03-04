"""Database utilities and startup helpers."""

from deeplab.db.engine import (
    execute,
    executemany,
    fetch_all,
    fetch_one,
    init_duckdb,
    open_session,
    transaction,
)

__all__ = [
    "execute",
    "executemany",
    "fetch_all",
    "fetch_one",
    "init_duckdb",
    "open_session",
    "transaction",
]
