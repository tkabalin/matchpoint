from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from matchpoint_api.config import settings

# hide_parameters because a DBAPI error stringifies its bound parameters into the
# message, and logs.py renders that traceback into the request log: without it a failed
# insert writes a password hash, and a failed session lookup a token hash, to stderr.
engine = create_engine(settings.database_url, hide_parameters=True)
session_factory = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session]:
    with session_factory() as session:
        yield session
