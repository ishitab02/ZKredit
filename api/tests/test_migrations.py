"""Alembic migration tests (1.2): `upgrade head` builds the full model schema.

Runs the real migration scripts against a throwaway SQLite database and asserts
the resulting tables match ``Base.metadata`` — so a broken/missing migration
fails CI instead of surfacing only on a production deploy.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config

from ml.data.models import Base

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def _alembic_config(db_url: str) -> Config:
    cfg = Config(str(_REPO_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(_REPO_ROOT / "migrations"))
    cfg.set_main_option("sqlalchemy.url", db_url)
    return cfg


def test_upgrade_head_builds_model_schema(tmp_path: Path) -> None:
    db_path = tmp_path / "migrated.db"
    # env.py builds an async engine, so use the async sqlite driver.
    command.upgrade(_alembic_config(f"sqlite+aiosqlite:///{db_path}"), "head")

    conn = sqlite3.connect(db_path)
    try:
        tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
    finally:
        conn.close()

    expected = set(Base.metadata.tables) | {"alembic_version"}
    assert expected <= tables, f"missing tables after upgrade: {expected - tables}"
