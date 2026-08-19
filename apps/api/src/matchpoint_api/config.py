from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
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
    # Which outbound email sender create_app builds (mail.py). "logging" writes the
    # message to the log and "file" appends it to email_file, both right for dev and
    # tests and a lie anywhere deployed; "resend" is the one that delivers, and is what
    # infra/prod/compose.yml sets. The default stays a harmless one, so nothing sends
    # real mail without being told to.
    email_sender: Literal["logging", "file", "resend"] = "logging"
    # Required when email_sender is "file", and unused otherwise. It exists for the
    # Playwright suite, which drives the real sign-up flow and so has to read back the
    # code the API "sent" (scripts/e2e-api.sh).
    email_file: Path | None = None
    # Required when email_sender is "resend", and unused otherwise — create_email_sender
    # refuses the pairing rather than letting a blank key become a 502 per sign-up.
    # SecretStr because a plain str reaches repr(), and this object is the kind of thing
    # that gets logged or dumped into a traceback whole.
    resend_api_key: SecretStr = SecretStr("")
    # Which breach-corpus checker create_app builds (breach.py). "pwned" asks Have I Been
    # Pwned, and is the default because there is no key whose absence would catch a box
    # that never configured one — a deployment left on "allow_all" would just quietly
    # stop checking. "allow_all" is the opt-out: what tests pin, and what a dev box that
    # would rather stay off the network sets.
    breach_checker: Literal["allow_all", "pwned"] = "pwned"
    # Multiplies every token bucket's burst and refill rate (rate_limit.py). For the
    # Playwright suite, which runs the real sign-up and sign-in flows from one address
    # far faster than the coach those limits are sized for. Never below 1: this may
    # loosen a limit for a test run, never quietly tighten one on a deployed box.
    rate_limit_scale: float = Field(default=1.0, ge=1)
    # Where uploaded photos are written (photos.py) and served from. Anchored to
    # apps/api/ like env_file above, so a dev box needs no configuration; production
    # points it at the Docker volume in infra/prod/compose.yml, which is the only
    # thing keeping the files across a deploy.
    media_root: Path = Path(__file__).parents[2] / "media"


settings = Settings()
