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
    # The deployed image tag, set from IMAGE_TAG by infra/prod/compose.yml and
    # reported by /health. The default is what anything not deployed reports:
    # nothing outside production has a commit to name.
    commit: str = "dev"
    # The session cookie's Secure flag. True everywhere deployed — the site is only
    # served over HTTPS — and in tests, whose client claims an https base URL. Local
    # dev over plain http://localhost still works in Chrome and Firefox, which treat
    # localhost as trustworthy; Safari does not, and needs
    # MATCHPOINT_SESSION_COOKIE_SECURE=false in apps/api/.env.
    session_cookie_secure: bool = True


settings = Settings()
