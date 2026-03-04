from __future__ import annotations

from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

import duckdb

from deeplab.db.config import DuckDBConfig, load_duckdb_config


@dataclass
class QueryResult:
    rows: list[dict[str, Any]]
    rowcount: int


class DuckDBSession:
    def __init__(self, path: Path, *, read_only: bool = False) -> None:
        self.path = path
        self.read_only = read_only
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = duckdb.connect(str(path), read_only=read_only)
        self.conn.execute("PRAGMA enable_object_cache=true;")

    def close(self) -> None:
        self.conn.close()

    def execute(self, sql: str, params: tuple[Any, ...] | list[Any] | None = None) -> QueryResult:
        cursor = self.conn.execute(sql, params or [])
        if cursor is None:
            return QueryResult(rows=[], rowcount=0)
        description = cursor.description
        if description:
            columns = [item[0] for item in description]
            rows = [dict(zip(columns, row, strict=False)) for row in cursor.fetchall()]
            return QueryResult(rows=rows, rowcount=len(rows))
        return QueryResult(rows=[], rowcount=getattr(cursor, "rowcount", -1))

    def executemany(self, sql: str, rows: list[tuple[Any, ...]] | list[list[Any]]) -> int:
        if not rows:
            return 0
        self.conn.executemany(sql, rows)
        return len(rows)


_CONFIG: DuckDBConfig | None = None
_SESSION: ContextVar[DuckDBSession | None] = ContextVar("deeplab_duckdb_session", default=None)


def get_duckdb_config() -> DuckDBConfig:
    global _CONFIG
    if _CONFIG is None:
        _CONFIG = load_duckdb_config()
    return _CONFIG


def init_duckdb(config: DuckDBConfig | None = None) -> DuckDBConfig:
    global _CONFIG
    _CONFIG = config or load_duckdb_config()
    _CONFIG.path.parent.mkdir(parents=True, exist_ok=True)
    if not _CONFIG.read_only:
        probe = duckdb.connect(str(_CONFIG.path), read_only=False)
        probe.close()
    return _CONFIG


@asynccontextmanager
async def open_session(*, read_only: bool | None = None):
    config = get_duckdb_config()
    session = DuckDBSession(
        config.path,
        read_only=config.read_only if read_only is None else read_only,
    )
    token = _SESSION.set(session)
    try:
        yield session
    finally:
        _SESSION.reset(token)
        session.close()


def _current_or_temp_session(read_only: bool | None = None) -> tuple[DuckDBSession, bool]:
    current = _SESSION.get()
    if current is not None:
        return current, False

    config = get_duckdb_config()
    session = DuckDBSession(
        config.path,
        read_only=config.read_only if read_only is None else read_only,
    )
    return session, True


def execute(sql: str, params: tuple[Any, ...] | list[Any] | None = None) -> int:
    session, owned = _current_or_temp_session()
    try:
        result = session.execute(sql, params)
        return result.rowcount
    finally:
        if owned:
            session.close()


def fetch_all(sql: str, params: tuple[Any, ...] | list[Any] | None = None) -> list[dict[str, Any]]:
    session, owned = _current_or_temp_session()
    try:
        result = session.execute(sql, params)
        return result.rows
    finally:
        if owned:
            session.close()


def fetch_one(sql: str, params: tuple[Any, ...] | list[Any] | None = None) -> dict[str, Any] | None:
    rows = fetch_all(sql, params)
    if not rows:
        return None
    return rows[0]


def executemany(sql: str, rows: list[tuple[Any, ...]] | list[list[Any]]) -> int:
    session, owned = _current_or_temp_session()
    try:
        return session.executemany(sql, rows)
    finally:
        if owned:
            session.close()


async def transaction(
    fn: Callable[[DuckDBSession], Awaitable[Any] | Any],
) -> Any:
    async with open_session(read_only=False) as session:
        session.execute("BEGIN TRANSACTION;")
        try:
            result = fn(session)
            if hasattr(result, "__await__"):
                result = await result  # type: ignore[assignment]
            session.execute("COMMIT;")
            return result
        except Exception:
            session.execute("ROLLBACK;")
            raise
