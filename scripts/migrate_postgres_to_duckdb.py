#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
from pathlib import Path

from dotenv import load_dotenv

from deeplab.db.config import load_duckdb_config
from deeplab.db.engine import DuckDBSession, init_duckdb
from deeplab.db.migrate import apply_migrations, default_migrations_dir
from deeplab.model import (
    DailyWorkNoteSnapshot,
    DailyWorkReport,
    KnowledgeExtractionRun,
    KnowledgeNote,
    KnowledgeNoteLink,
    KnowledgeQuestion,
    KnowledgeSolution,
    LLMInvocationLog,
    Paper,
    PaperFilteringDecision,
    PaperFilteringRun,
    PaperReadingReport,
    PaperReadingRun,
    RuntimeSetting,
    ScreeningRule,
    TodoTask,
    WorkflowExecution,
    WorkflowStageExecution,
)


def _quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _quote_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


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
                f"{sequence_name}: current_next={effective_last + 1}, "
                f"target_next={target_next}, skip sequence rewind"
            )
        return

    steps = target_last - effective_last
    session.execute(
        f"SELECT max(nextval({_quote_literal(sequence_name)})) AS advanced_to FROM range(?);",
        [steps],
    )


def _build_postgres_attach_dsn() -> str:
    host = os.getenv("POSTGRES_HOST", "127.0.0.1").strip()
    port = os.getenv("POSTGRES_PORT", "5432").strip()
    user = os.getenv("POSTGRES_USER", "postgres").strip()
    password = os.getenv("POSTGRES_PASSWORD", "").strip()
    db_name = os.getenv("POSTGRES_DB", "deeplab").strip()

    return (
        f"host={host} "
        f"port={port} "
        f"dbname={db_name} "
        f"user={user} "
        f"password={password}"
    )


def _ordered_models() -> list[type]:
    return [
        Paper,
        ScreeningRule,
        TodoTask,
        WorkflowExecution,
        WorkflowStageExecution,
        LLMInvocationLog,
        PaperFilteringRun,
        PaperFilteringDecision,
        PaperReadingRun,
        PaperReadingReport,
        KnowledgeQuestion,
        KnowledgeSolution,
        KnowledgeExtractionRun,
        KnowledgeNote,
        KnowledgeNoteLink,
        RuntimeSetting,
        DailyWorkReport,
        DailyWorkNoteSnapshot,
    ]


def _list_source_tables(session: DuckDBSession) -> set[str]:
    rows = session.execute(
        """
        SELECT table_name
        FROM pg.information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
        """
    ).rows
    return {str(item.get("table_name") or "") for item in rows}


def _list_source_columns(session: DuckDBSession, table_name: str) -> set[str]:
    rows = session.execute(
        """
        SELECT column_name
        FROM pg.information_schema.columns
        WHERE table_schema = 'public' AND table_name = ?;
        """,
        [table_name],
    ).rows
    return {str(item.get("column_name") or "") for item in rows}


def _compat_candidates(table: str, target_col: str) -> list[str]:
    if table == "knowledge_notes":
        mapping = {
            "content_json": ["content_json", "contentJson", "contentjson"],
            "plain_text": ["plain_text", "plainText", "plaintext"],
            "created_by": ["created_by", "createdBy", "createdby"],
            "created_at": ["created_at", "createdAt", "createdat"],
            "updated_at": ["updated_at", "updatedAt", "updatedat"],
        }
        return mapping.get(target_col, [target_col])

    if table == "knowledge_note_links":
        mapping = {
            "source_note_id": ["source_note_id", "sourceNoteId", "sourcenoteid"],
            "target_type": ["target_type", "targetType", "targettype"],
            "target_id": ["target_id", "targetId", "targetid"],
            "target_label": ["target_label", "targetLabel", "targetlabel"],
            "created_at": ["created_at", "createdAt", "createdat"],
        }
        return mapping.get(target_col, [target_col])

    return [target_col]


def _default_expression(table: str, target_col: str) -> str | None:
    if table == "knowledge_notes":
        defaults = {
            "content_json": "CAST('{}' AS JSON)",
            "plain_text": "''",
            "created_by": "'user'",
            "created_at": "CURRENT_TIMESTAMP",
            "updated_at": "CURRENT_TIMESTAMP",
        }
        return defaults.get(target_col)

    if table == "knowledge_note_links":
        defaults = {
            "target_type": "'note'",
            "target_id": "''",
            "created_at": "CURRENT_TIMESTAMP",
        }
        return defaults.get(target_col)

    return None


def _build_insert_projection(
    *,
    table: str,
    target_columns: list[str],
    source_columns: set[str],
) -> tuple[list[str], list[str]]:
    insert_cols: list[str] = []
    select_exprs: list[str] = []

    for target_col in target_columns:
        expr: str | None = None
        for candidate in _compat_candidates(table, target_col):
            if candidate in source_columns:
                expr = _quote_ident(candidate)
                break
        if expr is None:
            expr = _default_expression(table, target_col)
        if expr is None:
            continue

        insert_cols.append(target_col)
        select_exprs.append(expr)

    return insert_cols, select_exprs


def _delete_target_rows(session: DuckDBSession, tables: list[str]) -> None:
    for table in reversed(tables):
        session.execute(f"DELETE FROM {_quote_ident(table)};")


def _align_sequences(session: DuckDBSession) -> None:
    row = session.execute("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM screening_rules;").rows[0]
    _ensure_sequence_next_value(
        session,
        sequence_name="screening_rules_id_seq",
        next_value=int(row["next_id"]),
    )

    row = session.execute("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM todo_tasks;").rows[0]
    _ensure_sequence_next_value(
        session,
        sequence_name="todo_tasks_id_seq",
        next_value=int(row["next_id"]),
    )


def _migrate(
    *,
    yes: bool,
    dry_run: bool,
    skip_migrations: bool,
) -> int:
    load_dotenv()
    if not yes:
        print("警告：该脚本会向 DuckDB 导入 PostgreSQL 历史数据并覆盖目标表。")
        text = input("请输入 YES 继续：").strip()
        if text != "YES":
            print("已取消。")
            return 1

    config = init_duckdb(load_duckdb_config())
    if not skip_migrations:
        apply_migrations(migrations_dir=default_migrations_dir(), verbose=True)

    ordered_models = _ordered_models()
    tables = [model._meta.table for model in ordered_models]
    model_by_table = {model._meta.table: model for model in ordered_models}

    session = DuckDBSession(config.path, read_only=False)
    try:
        session.execute("INSTALL postgres;")
        session.execute("LOAD postgres;")

        dsn = _build_postgres_attach_dsn()
        attach_sql = f"ATTACH {_quote_literal(dsn)} AS pg (TYPE postgres, READ_ONLY);"
        session.execute(attach_sql)
        try:
            source_tables = _list_source_tables(session)

            print("迁移表清单：")
            for table in tables:
                print(f"- {table}")

            if dry_run:
                print("dry-run 模式，不执行写入。")
                for table in tables:
                    if table not in source_tables:
                        print(f"{table}: source missing")
                        continue
                    source_count = int(
                        session.execute(f"SELECT COUNT(*) AS total FROM pg.public.{_quote_ident(table)};").rows[0][
                            "total"
                        ]
                    )
                    print(f"{table}: source_count={source_count}")
                return 0

            session.execute("BEGIN TRANSACTION;")
            try:
                _delete_target_rows(session, tables)

                for table in tables:
                    if table not in source_tables:
                        print(f"Skip {table}: source table not found")
                        continue

                    target_columns = list(model_by_table[table]._meta.fields.values())
                    source_columns = _list_source_columns(session, table)
                    insert_cols, select_exprs = _build_insert_projection(
                        table=table,
                        target_columns=target_columns,
                        source_columns=source_columns,
                    )

                    if not insert_cols:
                        print(f"Skip {table}: no compatible columns")
                        continue

                    insert_list = ", ".join(_quote_ident(item) for item in insert_cols)
                    select_list = ", ".join(select_exprs)

                    sql = (
                        f"INSERT INTO {_quote_ident(table)} ({insert_list}) "
                        f"SELECT {select_list} FROM pg.public.{_quote_ident(table)};"
                    )
                    session.execute(sql)

                    source_count = int(
                        session.execute(f"SELECT COUNT(*) AS total FROM pg.public.{_quote_ident(table)};").rows[0][
                            "total"
                        ]
                    )
                    target_count = int(
                        session.execute(f"SELECT COUNT(*) AS total FROM {_quote_ident(table)};").rows[0][
                            "total"
                        ]
                    )
                    print(f"{table}: source={source_count}, target={target_count}")

                _align_sequences(session)
                session.execute("COMMIT;")
            except Exception:
                session.execute("ROLLBACK;")
                raise

            session.execute("CHECKPOINT;")
            print(f"导入完成: {Path(config.path)}")
            return 0
        finally:
            try:
                session.execute("DETACH pg;")
            except Exception:
                pass

    finally:
        session.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate PostgreSQL data into DuckDB")
    parser.add_argument("--yes", action="store_true", help="Skip interactive confirmation")
    parser.add_argument("--dry-run", action="store_true", help="Only inspect source tables/counts")
    parser.add_argument(
        "--skip-migrations",
        action="store_true",
        help="Do not run DuckDB migrations before importing",
    )
    args = parser.parse_args()

    raise SystemExit(
        _migrate(
            yes=args.yes,
            dry_run=args.dry_run,
            skip_migrations=args.skip_migrations,
        )
    )


if __name__ == "__main__":
    main()
