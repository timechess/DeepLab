from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
from typing import Iterable

from deeplab.db.config import load_duckdb_config
from deeplab.db.engine import DuckDBSession, init_duckdb


MIGRATION_TABLE = "schema_migrations"


def _migration_files(migrations_dir: Path) -> list[Path]:
    return sorted(path for path in migrations_dir.glob("*.sql") if path.is_file())


def _checksum(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _ensure_table(session: DuckDBSession) -> None:
    session.execute(
        f'''
        CREATE TABLE IF NOT EXISTS "{MIGRATION_TABLE}" (
            "version" VARCHAR PRIMARY KEY,
            "checksum" VARCHAR NOT NULL,
            "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        '''
    )


def _applied_map(session: DuckDBSession) -> dict[str, str]:
    rows = session.execute(
        f'SELECT "version", "checksum" FROM "{MIGRATION_TABLE}" ORDER BY "version";'
    ).rows
    return {str(row["version"]): str(row["checksum"]) for row in rows}


def apply_migrations(*, migrations_dir: Path, verbose: bool = True) -> int:
    config = init_duckdb(load_duckdb_config())
    session = DuckDBSession(config.path, read_only=False)
    applied_count = 0
    try:
        _ensure_table(session)
        applied = _applied_map(session)

        for path in _migration_files(migrations_dir):
            version = path.name
            content = path.read_text(encoding="utf-8")
            digest = _checksum(content)

            if version in applied:
                if applied[version] != digest:
                    raise RuntimeError(
                        f"Migration checksum mismatch: {version}. "
                        "The file changed after being applied."
                    )
                continue

            if verbose:
                print(f"Applying migration: {version}")
            session.execute("BEGIN TRANSACTION;")
            try:
                session.execute(content)
                session.execute(
                    f'INSERT INTO "{MIGRATION_TABLE}" ("version", "checksum") VALUES (?, ?);',
                    [version, digest],
                )
                session.execute("COMMIT;")
            except Exception:
                session.execute("ROLLBACK;")
                raise
            applied_count += 1

        if verbose:
            print(f"Migration complete. Applied: {applied_count}")
        return applied_count
    finally:
        session.close()


def default_migrations_dir() -> Path:
    return Path(__file__).resolve().parent / "migrations"


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Apply DuckDB schema migrations")
    parser.add_argument(
        "--migrations-dir",
        default=str(default_migrations_dir()),
        help="Directory containing *.sql migration files.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress migration logs.",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    apply_migrations(migrations_dir=Path(args.migrations_dir), verbose=not args.quiet)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
