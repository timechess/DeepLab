"""Deprecated PostgreSQL schema guards.

Schema management moved to versioned SQL migrations in ``deeplab/db/migrations``.
These compatibility no-op functions are kept so older imports do not break.
"""


async def normalize_knowledge_note_schema_columns() -> None:
    return None


async def ensure_knowledge_note_schema_columns() -> None:
    return None


async def ensure_daily_work_report_schema_columns() -> None:
    return None
