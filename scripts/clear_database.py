#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from deeplab.db.config import load_duckdb_config
from deeplab.db.engine import DuckDBSession
from deeplab.model import list_registered_models
from dotenv import load_dotenv

load_dotenv()

def _quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _get_sequence_last_value(session: DuckDBSession, sequence_name: str) -> int | None:
    row = session.execute(
        """
        SELECT last_value
        FROM duckdb_sequences()
        WHERE schema_name = 'main' AND sequence_name = ?;
        """,
        [sequence_name],
    ).rows
    if not row:
        raise RuntimeError(f"DuckDB sequence not found: {sequence_name}")

    value = row[0].get("last_value")
    if value is None:
        return None
    return int(value)


def _ensure_sequence_next_value(
    session: DuckDBSession,
    *,
    sequence_name: str,
    next_value: int,
) -> None:
    target_next = max(int(next_value), 1)
    target_last = target_next - 1

    current_last = _get_sequence_last_value(session, sequence_name)
    effective_last = 0 if current_last is None else current_last
    if effective_last >= target_last:
        if effective_last > target_last:
            print(
                f"提示: {sequence_name} 已推进到 {effective_last + 1}，"
                "DuckDB 当前不支持回退 sequence。"
            )
        return

    steps = target_last - effective_last
    session.execute(
        f"SELECT max(nextval('{sequence_name}')) AS advanced_to FROM range(?);",
        [steps],
    )


def _candidate_table_names() -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for model in list_registered_models():
        table_name = model._meta.table
        if table_name in seen:
            continue
        seen.add(table_name)
        names.append(table_name)
    return names


def _resolve_existing_tables(session: DuckDBSession, table_names: list[str]) -> list[str]:
    rows = session.execute(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'main' AND table_type = 'BASE TABLE';
        """
    ).rows
    existing = {str(item.get("table_name") or "") for item in rows}
    return [name for name in table_names if name in existing]


def _confirm(force: bool) -> bool:
    if force:
        return True
    print("警告：该操作会永久删除当前 DuckDB 中的 DeepLab 业务数据。")
    text = input("请输入 YES 继续：").strip()
    return text == "YES"


def _reset_sequences(session: DuckDBSession) -> None:
    _ensure_sequence_next_value(
        session,
        sequence_name="screening_rules_id_seq",
        next_value=1,
    )
    _ensure_sequence_next_value(
        session,
        sequence_name="todo_tasks_id_seq",
        next_value=1,
    )


def _run(force: bool, dry_run: bool) -> int:
    if not _confirm(force=force):
        print("已取消。")
        return 1

    config = load_duckdb_config()
    db_path = Path(config.path)
    if not db_path.exists():
        print(f"数据库文件不存在：{db_path}")
        return 1

    session = DuckDBSession(db_path, read_only=False)
    try:
        tables = _resolve_existing_tables(session, _candidate_table_names())
        if not tables:
            print("没有找到可清空的业务表。")
            return 0

        print("目标表：")
        for name in tables:
            print(f"- {name}")

        if dry_run:
            print("dry-run 模式，不会执行删除。")
            return 0

        session.execute("BEGIN TRANSACTION;")
        try:
            for name in tables:
                session.execute(f"DELETE FROM {_quote_ident(name)};")
            _reset_sequences(session)
            session.execute("COMMIT;")
        except Exception:
            session.execute("ROLLBACK;")
            raise

        session.execute("CHECKPOINT;")
        print(f"完成：已清空 {len(tables)} 张表。")
        return 0
    finally:
        session.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="清空 DeepLab DuckDB 业务表（用于测试）")
    parser.add_argument("--yes", action="store_true", help="跳过交互确认，直接执行。")
    parser.add_argument("--dry-run", action="store_true", help="仅打印将要清空的表，不执行删除。")
    args = parser.parse_args()
    raise SystemExit(_run(force=args.yes, dry_run=args.dry_run))


if __name__ == "__main__":
    main()
