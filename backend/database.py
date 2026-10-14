import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()

SQLALCHEMY_DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://vault_user:vault_password@localhost:5432/vault_db",
)

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def run_schema_migrations():
    statements = [
        "ALTER TABLE notes ADD COLUMN IF NOT EXISTS user_id VARCHAR",
        "ALTER TABLE notes ADD COLUMN IF NOT EXISTS scheduled_time VARCHAR",
        "ALTER TABLE notes ADD COLUMN IF NOT EXISTS end_date DATE",
        "ALTER TABLE canvases ADD COLUMN IF NOT EXISTS user_id VARCHAR",
        "ALTER TABLE feedbacks ADD COLUMN IF NOT EXISTS user_id VARCHAR",
        "CREATE INDEX IF NOT EXISTS ix_notes_user_id ON notes (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_canvases_user_id ON canvases (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_feedbacks_user_id ON feedbacks (user_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_mobile_number ON users (mobile_number)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS has_set_vault BOOLEAN DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS encrypted_master_seed TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS seed_verifier TEXT",
        "UPDATE notes SET status = NULL WHERE scheduled_date IS NULL AND end_date IS NULL AND recurrence_rule IS NULL AND status = 'todo'",
        "ALTER TABLE notes ADD COLUMN IF NOT EXISTS parent_note_id VARCHAR REFERENCES notes(id) ON DELETE SET NULL",
        "CREATE INDEX IF NOT EXISTS ix_notes_parent_note_id ON notes (parent_note_id)",
        # Added without a default so existing rows are NULL and get backfilled exactly once below.
        "ALTER TABLE notes ADD COLUMN IF NOT EXISTS canvas_only BOOLEAN",
        "UPDATE notes SET canvas_only = EXISTS (SELECT 1 FROM canvas_nodes c WHERE c.note_id = notes.id) WHERE canvas_only IS NULL",
        "ALTER TABLE notes ALTER COLUMN canvas_only SET DEFAULT FALSE",
        "ALTER TABLE notes ALTER COLUMN canvas_only SET NOT NULL",
        "ALTER TABLE canvas_nodes ADD COLUMN IF NOT EXISTS mirrored BOOLEAN NOT NULL DEFAULT FALSE",
        # One-time: move canvas parent links onto notes, then drop the old column.
        # Guarded by the column's existence, so it is a no-op on every later startup.
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'canvas_nodes' AND column_name = 'parent_node_id'
            ) THEN
                UPDATE notes n
                SET parent_note_id = pn.note_id
                FROM canvas_nodes c
                JOIN canvas_nodes pn ON c.parent_node_id = pn.id
                WHERE c.note_id = n.id
                  AND n.parent_note_id IS NULL
                  AND pn.note_id <> n.id;
                ALTER TABLE canvas_nodes DROP COLUMN parent_node_id;
            END IF;
        END $$;
        """,
    ]

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
