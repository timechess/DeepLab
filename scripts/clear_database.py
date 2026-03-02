#!/usr/bin/env python3
import argparse
import asyncio
import os
from urllib.parse import quote_plus

from tortoise import Tortoise, connections

from deeplab.model import (
    LLMInvocationLog,
    Paper,
    PaperFilteringDecision,
    PaperFilteringRun,
    PaperReadingReport,
    PaperReadingRun,
    RuntimeSetting,
    ScreeningRule,
    WorkflowExecution,
    WorkflowStageExecution,
)

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    load_dotenv = None


MODEL_CLASSES = (
    Paper,
    ScreeningRule,
    WorkflowExecution,
    WorkflowStageExecution,
    LLMInvocationLog,
    PaperFilteringRun,
    PaperFilteringDecision,
    PaperReadingRun,
    PaperReadingReport,
    RuntimeSetting,
)


def _build_postgres_dsn() -> str:
    user = os.getenv("POSTGRES_USER", "postgres")
    password = os.getenv("POSTGRES_PASSWORD", "")
    host = os.getenv("POSTGRES_HOST", "127.0.0.1")
    port = os.getenv("POSTGRES_PORT", "5432")
    db_name = os.getenv("POSTGRES_DB", "deeplab")
    return f"postgres://{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{quote_plus(db_name)}"


def _build_candidate_table_names() -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for model_class in MODEL_CLASSES:
        table_name = model_class._meta.db_table
        if table_name not in seen:
            seen.add(table_name)
            names.append(table_name)
    return names


def _quote_table_name(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


async def _resolve_existing_tables(table_names: list[str]) -> list[str]:
    conn = connections.get("default")
    rows = await conn.execute_query_dict("SELECT tablename FROM pg_tables WHERE schemaname='public';")
    existing = {str(row.get("tablename", "")) for row in rows}
    return [name for name in table_names if name in existing]


async def _clear_tables(table_names: list[str], dry_run: bool) -> int:
    existing_tables = await _resolve_existing_tables(table_names)
    if not existing_tables:
        print("没有找到可清空的业务表。")
        return 0

    print("目标表：")
    for name in existing_tables:
        print(f"- {name}")

    if dry_run:
        print("dry-run 模式，不会执行 TRUNCATE。")
        return len(existing_tables)

    conn = connections.get("default")
    quoted = ", ".join(_quote_table_name(name) for name in existing_tables)
    sql = f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE;"
    await conn.execute_script(sql)
    return len(existing_tables)


def _confirm(force: bool) -> bool:
    if force:
        return True

    print("警告：该操作会永久删除当前数据库中的 DeepLab 业务数据。")
    text = input("请输入 YES 继续：").strip()
    return text == "YES"


async def _run(force: bool, dry_run: bool) -> int:
    if load_dotenv is not None:
        load_dotenv()

    if not _confirm(force=force):
        print("已取消。")
        return 1

    await Tortoise.init(
        db_url=_build_postgres_dsn(),
        modules={"models": ["deeplab.model"]},
        use_tz=True,
        timezone="UTC",
    )
    try:
        table_count = await _clear_tables(_build_candidate_table_names(), dry_run=dry_run)
    finally:
        await Tortoise.close_connections()

    if not dry_run:
        print(f"完成：已清空 {table_count} 张表。")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="清空 DeepLab PostgreSQL 业务表（用于测试）")
    parser.add_argument(
        "--yes",
        action="store_true",
        help="跳过交互确认，直接执行。",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="仅打印将要清空的表，不执行删除。",
    )
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_run(force=args.yes, dry_run=args.dry_run)))


if __name__ == "__main__":
    main()
