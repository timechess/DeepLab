from __future__ import annotations

import asyncio
import json
import sqlite3
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from deeplab.db.engine import executemany
from deeplab.db.engine import get_duckdb_config
from deeplab.model import DailyWorkNoteSnapshot, KnowledgeNote, KnowledgeNoteLink

_LOCK = threading.Lock()
_SYNC_TASK: asyncio.Task[None] | None = None
_STOP_EVENT: asyncio.Event | None = None
_DEFAULT_SYNC_INTERVAL_SECONDS = 180
_DEFAULT_SYNC_BATCH_SIZE = 200


def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


def _sqlite_path() -> Path:
    duckdb_path = get_duckdb_config().path
    return duckdb_path.parent / "notes.sqlite3"


def _open_conn() -> sqlite3.Connection:
    path = _sqlite_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def _run_sqlite(fn):
    with _LOCK:
        conn = _open_conn()
        try:
            return fn(conn)
        finally:
            conn.close()


def _init_schema_sync(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content_json TEXT NOT NULL,
            plain_text TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0,
            dirty INTEGER NOT NULL DEFAULT 1
        );
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS note_links (
            id TEXT PRIMARY KEY,
            source_note_id TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT NOT NULL,
            target_label TEXT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0,
            dirty INTEGER NOT NULL DEFAULT 1,
            UNIQUE(source_note_id, target_type, target_id)
        );
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_links_source ON note_links(source_note_id);"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_links_target_note ON note_links(target_type, target_id);"
    )


async def ensure_note_store() -> None:
    def _work(conn: sqlite3.Connection) -> None:
        _init_schema_sync(conn)
        row = conn.execute("SELECT value FROM meta WHERE key = 'bootstrapped';").fetchone()
        if row is not None:
            conn.commit()
            return
        conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES('bootstrapped', '0');")
        conn.commit()

    await asyncio.to_thread(_run_sqlite, _work)
    await bootstrap_from_duckdb_if_needed()


async def bootstrap_from_duckdb_if_needed() -> None:
    def _is_bootstrapped(conn: sqlite3.Connection) -> bool:
        row = conn.execute("SELECT value FROM meta WHERE key = 'bootstrapped';").fetchone()
        return row is not None and str(row["value"]) == "1"

    bootstrapped = await asyncio.to_thread(_run_sqlite, _is_bootstrapped)
    if bootstrapped:
        return

    notes = await KnowledgeNote.all().all()
    links = await KnowledgeNoteLink.all().all()

    def _write(conn: sqlite3.Connection) -> None:
        _init_schema_sync(conn)
        note_rows = [
            (
                str(note.id),
                note.title,
                json.dumps(note.content_json if isinstance(note.content_json, dict) else {"type": "doc", "content": []}, ensure_ascii=False, separators=(",", ":")),
                note.plain_text,
                note.created_by,
                note.created_at.isoformat() if note.created_at else _now_iso(),
                note.updated_at.isoformat() if note.updated_at else _now_iso(),
                0,
                0,
            )
            for note in notes
            if note.id is not None
        ]
        link_rows = [
            (
                str(link.id),
                str(link.source_note_id),
                link.target_type,
                link.target_id,
                link.target_label,
                link.created_at.isoformat() if link.created_at else _now_iso(),
                link.created_at.isoformat() if link.created_at else _now_iso(),
                0,
                0,
            )
            for link in links
            if link.id is not None and link.source_note_id is not None
        ]
        if note_rows:
            conn.executemany(
                """
                INSERT OR REPLACE INTO notes
                    (id, title, content_json, plain_text, created_by, created_at, updated_at, deleted, dirty)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                note_rows,
            )
        if link_rows:
            conn.executemany(
                """
                INSERT OR REPLACE INTO note_links
                    (id, source_note_id, target_type, target_id, target_label, created_at, updated_at, deleted, dirty)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                link_rows,
            )
        conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES('bootstrapped', '1');")
        conn.commit()

    await asyncio.to_thread(_run_sqlite, _write)


def _parse_json(value: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {"type": "doc", "content": []}
    if isinstance(parsed, dict):
        return parsed
    return {"type": "doc", "content": []}


async def get_note(note_id: str) -> dict[str, Any] | None:
    await ensure_note_store()

    def _work(conn: sqlite3.Connection):
        row = conn.execute(
            """
            SELECT id, title, content_json, plain_text, created_by, created_at, updated_at
            FROM notes
            WHERE id = ? AND deleted = 0;
            """,
            (note_id,),
        ).fetchone()
        if row is None:
            return None
        return {
            "id": str(row["id"]),
            "title": str(row["title"] or ""),
            "content_json": _parse_json(str(row["content_json"] or "{}")),
            "plain_text": str(row["plain_text"] or ""),
            "created_by": str(row["created_by"] or "user"),
            "created_at": str(row["created_at"]),
            "updated_at": str(row["updated_at"]),
        }

    return await asyncio.to_thread(_run_sqlite, _work)


async def list_notes(*, search: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    await ensure_note_store()
    keyword = str(search or "").strip()
    safe_limit = min(max(limit, 1), 200)

    def _work(conn: sqlite3.Connection):
        if keyword:
            rows = conn.execute(
                """
                SELECT id, title, plain_text, created_by, created_at, updated_at
                FROM notes
                WHERE deleted = 0 AND (title LIKE ? OR plain_text LIKE ?)
                ORDER BY updated_at DESC
                LIMIT ?;
                """,
                (f"%{keyword}%", f"%{keyword}%", safe_limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, title, plain_text, created_by, created_at, updated_at
                FROM notes
                WHERE deleted = 0
                ORDER BY updated_at DESC
                LIMIT ?;
                """,
                (safe_limit,),
            ).fetchall()
        return [
            {
                "id": str(row["id"]),
                "title": str(row["title"] or ""),
                "plain_text": str(row["plain_text"] or ""),
                "created_by": str(row["created_by"] or "user"),
                "created_at": str(row["created_at"]),
                "updated_at": str(row["updated_at"]),
            }
            for row in rows
        ]

    return await asyncio.to_thread(_run_sqlite, _work)


async def count_note_links(note_ids: list[str]) -> tuple[dict[str, int], dict[str, int]]:
    await ensure_note_store()
    if not note_ids:
        return {}, {}

    def _work(conn: sqlite3.Connection):
        placeholders = ",".join("?" for _ in note_ids)
        outgoing_rows = conn.execute(
            f"""
            SELECT source_note_id, COUNT(*) AS total
            FROM note_links
            WHERE deleted = 0 AND source_note_id IN ({placeholders})
            GROUP BY source_note_id;
            """,
            tuple(note_ids),
        ).fetchall()
        incoming_rows = conn.execute(
            f"""
            SELECT target_id, COUNT(*) AS total
            FROM note_links
            WHERE deleted = 0 AND target_type = 'note' AND target_id IN ({placeholders})
            GROUP BY target_id;
            """,
            tuple(note_ids),
        ).fetchall()
        outgoing_map = {str(row["source_note_id"]): int(row["total"]) for row in outgoing_rows}
        incoming_map = {str(row["target_id"]): int(row["total"]) for row in incoming_rows}
        return outgoing_map, incoming_map

    return await asyncio.to_thread(_run_sqlite, _work)


async def list_links_for_source(note_id: str) -> list[dict[str, Any]]:
    await ensure_note_store()

    def _work(conn: sqlite3.Connection):
        rows = conn.execute(
            """
            SELECT id, source_note_id, target_type, target_id, target_label, created_at
            FROM note_links
            WHERE source_note_id = ? AND deleted = 0
            ORDER BY created_at DESC;
            """,
            (note_id,),
        ).fetchall()
        return [
            {
                "id": str(row["id"]),
                "source_note_id": str(row["source_note_id"]),
                "target_type": str(row["target_type"]),
                "target_id": str(row["target_id"]),
                "target_label": None if row["target_label"] is None else str(row["target_label"]),
                "created_at": str(row["created_at"]),
            }
            for row in rows
        ]

    return await asyncio.to_thread(_run_sqlite, _work)


async def list_incoming_note_links(target_note_id: str) -> list[dict[str, Any]]:
    await ensure_note_store()

    def _work(conn: sqlite3.Connection):
        rows = conn.execute(
            """
            SELECT
                l.id,
                l.source_note_id,
                l.target_type,
                l.target_id,
                l.target_label,
                l.created_at,
                n.title AS source_note_title,
                n.updated_at AS source_note_updated_at
            FROM note_links l
            LEFT JOIN notes n ON n.id = l.source_note_id
            WHERE l.deleted = 0
              AND l.target_type = 'note'
              AND l.target_id = ?
              AND (n.deleted = 0 OR n.deleted IS NULL)
            ORDER BY l.created_at DESC;
            """,
            (target_note_id,),
        ).fetchall()
        return [
            {
                "id": str(row["id"]),
                "source_note_id": str(row["source_note_id"]),
                "target_type": str(row["target_type"]),
                "target_id": str(row["target_id"]),
                "target_label": None if row["target_label"] is None else str(row["target_label"]),
                "created_at": str(row["created_at"]),
                "source_note_title": None if row["source_note_title"] is None else str(row["source_note_title"]),
                "source_note_updated_at": None
                if row["source_note_updated_at"] is None
                else str(row["source_note_updated_at"]),
            }
            for row in rows
        ]

    return await asyncio.to_thread(_run_sqlite, _work)


async def create_or_update_note(
    *,
    note_id: str | None,
    title: str,
    content_json: dict[str, Any],
    plain_text: str,
    created_by: str,
) -> tuple[str, bool]:
    await ensure_note_store()
    now = _now_iso()
    serialized = json.dumps(content_json, ensure_ascii=False, separators=(",", ":"))
    new_id = note_id or str(uuid.uuid4())

    def _work(conn: sqlite3.Connection):
        existing = conn.execute(
            """
            SELECT title, content_json, plain_text, created_by, created_at, updated_at, deleted
            FROM notes
            WHERE id = ?;
            """,
            (new_id,),
        ).fetchone()
        if existing is None:
            conn.execute(
                """
                INSERT INTO notes
                    (id, title, content_json, plain_text, created_by, created_at, updated_at, deleted, dirty)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1);
                """,
                (new_id, title, serialized, plain_text, created_by, now, now),
            )
            conn.commit()
            return True

        changed = (
            str(existing["title"] or "") != title
            or str(existing["content_json"] or "") != serialized
            or str(existing["plain_text"] or "") != plain_text
            or int(existing["deleted"] or 0) != 0
        )
        if changed:
            conn.execute(
                """
                UPDATE notes
                SET title = ?, content_json = ?, plain_text = ?, updated_at = ?, deleted = 0, dirty = 1
                WHERE id = ?;
                """,
                (title, serialized, plain_text, now, new_id),
            )
            conn.commit()
            return True
        return False

    changed = await asyncio.to_thread(_run_sqlite, _work)
    return new_id, changed


async def replace_note_links(
    *,
    note_id: str,
    links: set[tuple[str, str, str | None]],
) -> bool:
    await ensure_note_store()
    now = _now_iso()
    desired_by_base = {(target_type, target_id): target_label for target_type, target_id, target_label in links}

    def _work(conn: sqlite3.Connection):
        rows = conn.execute(
            """
            SELECT id, target_type, target_id, target_label, deleted
            FROM note_links
            WHERE source_note_id = ?;
            """,
            (note_id,),
        ).fetchall()
        existing_by_base: dict[tuple[str, str], sqlite3.Row] = {}
        for row in rows:
            base_key = (str(row["target_type"]), str(row["target_id"]))
            if base_key not in existing_by_base:
                existing_by_base[base_key] = row

        changed = False
        for base_key, existing in existing_by_base.items():
            if base_key not in desired_by_base:
                if int(existing["deleted"] or 0) == 0:
                    conn.execute(
                        """
                        UPDATE note_links
                        SET deleted = 1, dirty = 1, updated_at = ?
                        WHERE id = ?;
                        """,
                        (now, str(existing["id"])),
                    )
                    changed = True
                continue
            desired_label = desired_by_base[base_key]
            desired_label_str = None if desired_label is None else str(desired_label)
            if (
                int(existing["deleted"] or 0) != 0
                or (None if existing["target_label"] is None else str(existing["target_label"])) != desired_label_str
            ):
                conn.execute(
                    """
                    UPDATE note_links
                    SET target_label = ?, deleted = 0, dirty = 1, updated_at = ?
                    WHERE id = ?;
                    """,
                    (desired_label_str, now, str(existing["id"])),
                )
                changed = True

        for (target_type, target_id), target_label in desired_by_base.items():
            if (target_type, target_id) in existing_by_base:
                continue
            conn.execute(
                """
                INSERT INTO note_links
                    (id, source_note_id, target_type, target_id, target_label, created_at, updated_at, deleted, dirty)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1);
                """,
                (str(uuid.uuid4()), note_id, target_type, target_id, target_label, now, now),
            )
            changed = True

        if changed:
            conn.commit()
        return changed

    return await asyncio.to_thread(_run_sqlite, _work)


async def delete_note(note_id: str) -> dict[str, int] | None:
    await ensure_note_store()
    now = _now_iso()

    def _work(conn: sqlite3.Connection):
        existing = conn.execute(
            "SELECT id, deleted FROM notes WHERE id = ?;",
            (note_id,),
        ).fetchone()
        if existing is None:
            return None
        conn.execute(
            """
            UPDATE notes
            SET deleted = 1, dirty = 1, updated_at = ?
            WHERE id = ?;
            """,
            (now, note_id),
        )
        deleted_outgoing = conn.execute(
            """
            UPDATE note_links
            SET deleted = 1, dirty = 1, updated_at = ?
            WHERE source_note_id = ? AND deleted = 0;
            """,
            (now, note_id),
        ).rowcount
        deleted_incoming = conn.execute(
            """
            UPDATE note_links
            SET deleted = 1, dirty = 1, updated_at = ?
            WHERE target_type = 'note' AND target_id = ? AND deleted = 0;
            """,
            (now, note_id),
        ).rowcount
        conn.commit()
        return {
            "deletedOutgoingLinks": int(deleted_outgoing),
            "deletedIncomingLinks": int(deleted_incoming),
        }

    return await asyncio.to_thread(_run_sqlite, _work)


async def search_note_targets(
    *,
    keyword: str,
    limit: int,
    exclude_note_id: str | None,
) -> list[dict[str, Any]]:
    await ensure_note_store()
    safe_limit = min(max(limit, 1), 50)

    def _work(conn: sqlite3.Connection):
        if keyword:
            rows = conn.execute(
                """
                SELECT id, title, plain_text
                FROM notes
                WHERE deleted = 0 AND (title LIKE ? OR plain_text LIKE ?)
                ORDER BY updated_at DESC
                LIMIT ?;
                """,
                (f"%{keyword}%", f"%{keyword}%", safe_limit * 2),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, title, plain_text
                FROM notes
                WHERE deleted = 0
                ORDER BY updated_at DESC
                LIMIT ?;
                """,
                (safe_limit * 2,),
            ).fetchall()

        payload: list[dict[str, Any]] = []
        for row in rows:
            note_id = str(row["id"])
            if exclude_note_id and note_id == exclude_note_id:
                continue
            plain_text = str(row["plain_text"] or "")
            subtitle = (plain_text[:96] + "...") if len(plain_text) > 96 else (plain_text or note_id)
            payload.append(
                {
                    "type": "note",
                    "id": note_id,
                    "label": str(row["title"] or ""),
                    "subtitle": subtitle,
                }
            )
            if len(payload) >= safe_limit:
                break
        return payload

    return await asyncio.to_thread(_run_sqlite, _work)


def _to_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed


async def has_dirty_changes() -> bool:
    await ensure_note_store()

    def _work(conn: sqlite3.Connection):
        note_dirty = conn.execute("SELECT 1 FROM notes WHERE dirty = 1 LIMIT 1;").fetchone()
        if note_dirty is not None:
            return True
        link_dirty = conn.execute("SELECT 1 FROM note_links WHERE dirty = 1 LIMIT 1;").fetchone()
        return link_dirty is not None

    return await asyncio.to_thread(_run_sqlite, _work)


async def sync_dirty_notes_to_duckdb(*, limit: int = _DEFAULT_SYNC_BATCH_SIZE) -> dict[str, int]:
    await ensure_note_store()
    if not await has_dirty_changes():
        return {"syncedNotes": 0, "syncedLinks": 0}

    def _dirty_note_ids(conn: sqlite3.Connection):
        rows = conn.execute(
            """
            SELECT DISTINCT id AS note_id
            FROM notes
            WHERE dirty = 1
            UNION
            SELECT DISTINCT source_note_id AS note_id
            FROM note_links
            WHERE dirty = 1
            LIMIT ?;
            """,
            (limit,),
        ).fetchall()
        return [str(row["note_id"]) for row in rows if row["note_id"]]

    note_ids = await asyncio.to_thread(_run_sqlite, _dirty_note_ids)
    if not note_ids:
        return {"syncedNotes": 0, "syncedLinks": 0}

    synced_notes = 0
    synced_links = 0
    for note_id in note_ids:
        note = await get_note(note_id)
        if note is None:
            await DailyWorkNoteSnapshot.filter(note_id=uuid.UUID(note_id)).delete()
            await KnowledgeNoteLink.filter(source_note_id=uuid.UUID(note_id)).delete()
            await KnowledgeNoteLink.filter(target_type="note", target_id=note_id).delete()
            await KnowledgeNote.filter(id=uuid.UUID(note_id)).delete()
            synced_notes += 1
        else:
            note_uuid = uuid.UUID(note["id"])
            persisted_note, _ = await KnowledgeNote.update_or_create(
                id=note_uuid,
                defaults={
                    "title": note["title"],
                    "content_json": note["content_json"],
                    "plain_text": note["plain_text"],
                    "created_by": note["created_by"],
                    "created_at": _to_datetime(note["created_at"]),
                    "updated_at": _to_datetime(note["updated_at"]),
                },
            )
            local_links = await list_links_for_source(note_id)
            local_by_base = {
                (item["target_type"], item["target_id"]): item
                for item in local_links
            }
            remote_links = await KnowledgeNoteLink.filter(source_note_id=note_uuid).all()
            remote_by_base = {(item.target_type, item.target_id): item for item in remote_links}

            delete_ids: list[uuid.UUID] = []
            update_rows: list[tuple[Any, ...]] = []
            create_items: list[KnowledgeNoteLink] = []

            for base_key, remote in remote_by_base.items():
                if base_key not in local_by_base:
                    if remote.id is not None:
                        delete_ids.append(remote.id)
                    continue
                local_label = local_by_base[base_key]["target_label"]
                if local_label != remote.target_label and remote.id is not None:
                    update_rows.append((local_label, str(remote.id)))

            for base_key, local in local_by_base.items():
                if base_key in remote_by_base:
                    continue
                create_items.append(
                    KnowledgeNoteLink(
                        id=uuid.UUID(local["id"]),
                        source_note=persisted_note,
                        target_type=local["target_type"],
                        target_id=local["target_id"],
                        target_label=local["target_label"],
                        created_at=_to_datetime(local["created_at"]),
                    )
                )

            if delete_ids:
                await KnowledgeNoteLink.filter(id__in=delete_ids).delete()
            if update_rows:
                executemany(
                    """
                    UPDATE knowledge_note_links
                    SET target_label = ?
                    WHERE id = ?;
                    """,
                    update_rows,
                )
            if create_items:
                await KnowledgeNoteLink.bulk_create(create_items)
            synced_notes += 1
            synced_links += len(local_links)

        def _mark_synced(conn: sqlite3.Connection):
            row = conn.execute("SELECT deleted FROM notes WHERE id = ?;", (note_id,)).fetchone()
            if row is None:
                conn.commit()
                return
            is_deleted = int(row["deleted"] or 0) != 0
            if is_deleted:
                conn.execute("DELETE FROM note_links WHERE source_note_id = ? OR (target_type = 'note' AND target_id = ?);", (note_id, note_id))
                conn.execute("DELETE FROM notes WHERE id = ?;", (note_id,))
            else:
                conn.execute("UPDATE notes SET dirty = 0 WHERE id = ?;", (note_id,))
                conn.execute("UPDATE note_links SET dirty = 0 WHERE source_note_id = ? AND deleted = 0;", (note_id,))
                conn.execute("DELETE FROM note_links WHERE source_note_id = ? AND deleted = 1;", (note_id,))
            conn.commit()

        await asyncio.to_thread(_run_sqlite, _mark_synced)

    return {"syncedNotes": synced_notes, "syncedLinks": synced_links}


async def _sync_loop(interval_seconds: int) -> None:
    assert _STOP_EVENT is not None
    await sync_dirty_notes_to_duckdb()
    while not _STOP_EVENT.is_set():
        try:
            await asyncio.wait_for(_STOP_EVENT.wait(), timeout=interval_seconds)
        except TimeoutError:
            pass
        if _STOP_EVENT.is_set():
            break
        await sync_dirty_notes_to_duckdb()


async def start_note_sync_worker(interval_seconds: int = _DEFAULT_SYNC_INTERVAL_SECONDS) -> None:
    global _SYNC_TASK, _STOP_EVENT
    await ensure_note_store()
    if _SYNC_TASK is not None and not _SYNC_TASK.done():
        return
    _STOP_EVENT = asyncio.Event()
    _SYNC_TASK = asyncio.create_task(_sync_loop(interval_seconds))


async def stop_note_sync_worker(*, flush: bool = True) -> None:
    global _SYNC_TASK, _STOP_EVENT
    if _SYNC_TASK is None:
        if flush:
            await sync_dirty_notes_to_duckdb()
        return
    if _STOP_EVENT is not None:
        _STOP_EVENT.set()
    _SYNC_TASK.cancel()
    try:
        await _SYNC_TASK
    except asyncio.CancelledError:
        pass
    finally:
        _SYNC_TASK = None
        _STOP_EVENT = None
    if flush:
        await sync_dirty_notes_to_duckdb()
