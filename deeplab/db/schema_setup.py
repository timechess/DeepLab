import logging

from tortoise import Tortoise

logger = logging.getLogger(__name__)

_NOTE_SCHEMA_COMPATIBILITY_RENAMES: dict[str, tuple[tuple[str, str], ...]] = {
    "knowledge_notes": (
        ("contentJson", "content_json"),
        ("contentjson", "content_json"),
        ("plainText", "plain_text"),
        ("plaintext", "plain_text"),
        ("createdBy", "created_by"),
        ("createdby", "created_by"),
        ("createdAt", "created_at"),
        ("createdat", "created_at"),
        ("updatedAt", "updated_at"),
        ("updatedat", "updated_at"),
    ),
    "knowledge_note_links": (
        ("sourceNoteId", "source_note_id"),
        ("sourcenoteid", "source_note_id"),
        ("targetType", "target_type"),
        ("targettype", "target_type"),
        ("targetId", "target_id"),
        ("targetid", "target_id"),
        ("targetLabel", "target_label"),
        ("targetlabel", "target_label"),
        ("createdAt", "created_at"),
        ("createdat", "created_at"),
    ),
}


def _quote_ident(name: str) -> str:
    return f'"{name.replace("\"", "\"\"")}"'


async def _fetch_table_columns(table_name: str) -> set[str]:
    connection = Tortoise.get_connection("default")
    rows = await connection.execute_query_dict(
        "SELECT column_name FROM information_schema.columns "
        f"WHERE table_schema = current_schema() AND table_name = '{table_name}'"
    )
    return {str(item["column_name"]) for item in rows if item.get("column_name")}


async def normalize_knowledge_note_schema_columns() -> None:
    connection = Tortoise.get_connection("default")
    for table_name, mappings in _NOTE_SCHEMA_COMPATIBILITY_RENAMES.items():
        columns = await _fetch_table_columns(table_name)
        if not columns:
            continue

        for old_name, new_name in mappings:
            if old_name not in columns or new_name in columns:
                continue
            await connection.execute_script(
                f"ALTER TABLE {_quote_ident(table_name)} "
                f"RENAME COLUMN {_quote_ident(old_name)} TO {_quote_ident(new_name)};"
            )
            logger.info(
                "Renamed column for note schema compatibility: %s.%s -> %s",
                table_name,
                old_name,
                new_name,
            )
            columns.remove(old_name)
            columns.add(new_name)


async def ensure_knowledge_note_schema_columns() -> None:
    connection = Tortoise.get_connection("default")
    await connection.execute_script(
        """
        CREATE TABLE IF NOT EXISTS "knowledge_notes" (
            "id" UUID NOT NULL PRIMARY KEY,
            "title" TEXT NOT NULL,
            "content_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
            "plain_text" TEXT NOT NULL DEFAULT '',
            "created_by" VARCHAR(64) NOT NULL DEFAULT 'user',
            "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    await connection.execute_script(
        """
        CREATE TABLE IF NOT EXISTS "knowledge_note_links" (
            "id" UUID NOT NULL PRIMARY KEY,
            "source_note_id" UUID NOT NULL,
            "target_type" VARCHAR(16) NOT NULL,
            "target_id" VARCHAR(128) NOT NULL,
            "target_label" TEXT,
            "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )

    note_columns = await _fetch_table_columns("knowledge_notes")
    note_column_ddl: dict[str, str] = {
        "title": "TEXT NOT NULL DEFAULT ''",
        "content_json": "JSONB NOT NULL DEFAULT '{}'::jsonb",
        "plain_text": "TEXT NOT NULL DEFAULT ''",
        "created_by": "VARCHAR(64) NOT NULL DEFAULT 'user'",
        "created_at": "TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP",
        "updated_at": "TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP",
    }
    for column_name, ddl in note_column_ddl.items():
        if column_name in note_columns:
            continue
        await connection.execute_script(
            f'ALTER TABLE "knowledge_notes" ADD COLUMN "{column_name}" {ddl};'
        )
        logger.info("Added missing note column: knowledge_notes.%s", column_name)

    link_columns = await _fetch_table_columns("knowledge_note_links")
    link_column_ddl: dict[str, str] = {
        "source_note_id": "UUID",
        "target_type": "VARCHAR(16) NOT NULL DEFAULT 'note'",
        "target_id": "VARCHAR(128) NOT NULL DEFAULT ''",
        "target_label": "TEXT",
        "created_at": "TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP",
    }
    for column_name, ddl in link_column_ddl.items():
        if column_name in link_columns:
            continue
        await connection.execute_script(
            f'ALTER TABLE "knowledge_note_links" ADD COLUMN "{column_name}" {ddl};'
        )
        logger.info("Added missing note link column: knowledge_note_links.%s", column_name)

    await connection.execute_script(
        'CREATE INDEX IF NOT EXISTS "idx_knowledge_notes_created_at" ON "knowledge_notes" ("created_at");'
    )
    await connection.execute_script(
        'CREATE INDEX IF NOT EXISTS "idx_knowledge_notes_updated_at" ON "knowledge_notes" ("updated_at");'
    )
    await connection.execute_script(
        'CREATE INDEX IF NOT EXISTS "idx_knowledge_note_links_created_at" ON "knowledge_note_links" ("created_at");'
    )
    await connection.execute_script(
        'CREATE INDEX IF NOT EXISTS "idx_knowledge_note_links_target_type_target_id" '
        'ON "knowledge_note_links" ("target_type", "target_id");'
    )
    await connection.execute_script(
        'CREATE UNIQUE INDEX IF NOT EXISTS "uidx_knowledge_note_links_source_target" '
        'ON "knowledge_note_links" ("source_note_id", "target_type", "target_id");'
    )

