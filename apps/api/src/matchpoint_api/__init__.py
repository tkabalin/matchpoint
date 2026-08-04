"""MatchPoint API."""

from importlib.metadata import version

# Single source of truth is pyproject.toml's [project] version, read back from the
# installed distribution metadata so the two cannot drift.
__version__ = version("matchpoint-api")
