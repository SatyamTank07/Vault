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
