from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from the environment or a local .env file."""

    # Anchored to apps/api/ rather than CWD-relative, so running pytest/alembic
    # from the repo root still picks up apps/api/.env instead of silently
    # falling back to the defaults below.
    model_config = SettingsConfigDict(
        env_prefix="MATCHPOINT_",
        env_file=Path(__file__).parents[2] / ".env",
        extra="ignore",
    )

    debug: bool = False
    database_url: str = "postgresql+psycopg://matchpoint:matchpoint@localhost:5432/matchpoint"


settings = Settings()
