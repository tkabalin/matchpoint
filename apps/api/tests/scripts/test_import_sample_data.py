"""The sample-data import, which is the one write path into prod that no route guards.

It runs by hand against shared prod state, so the things worth pinning are the ones a
dry run wouldn't reveal: that a CSV cell parses to what the column expects, that a bad
row names its own line rather than failing as a constraint violation, and that running
the same CSVs twice converges instead of duplicating a roster.
"""

from datetime import date

import pytest

from scripts.import_sample_data import _blank_to_none, _parse_bool, _parse_date


@pytest.mark.parametrize(
    ("value", "expected"),
    [("Kabalin", "Kabalin"), ("  padded  ", "padded"), ("", None), ("   ", None)],
)
def test_blank_to_none_strips_and_empties(value: str, expected: str | None) -> None:
    assert _blank_to_none(value) == expected


def test_parse_date_reads_an_iso_date() -> None:
    assert _parse_date("2026-08-24") == date(2026, 8, 24)


def test_parse_date_treats_a_blank_cell_as_unset() -> None:
    assert _parse_date("   ") is None


def test_parse_date_refuses_a_malformed_date() -> None:
    with pytest.raises(ValueError):
        _parse_date("24/08/2026")


@pytest.mark.parametrize("value", ["true", "TRUE", " True ", "1", "yes", "YES"])
def test_parse_bool_reads_every_spelling_of_true(value: str) -> None:
    assert _parse_bool(value) is True


@pytest.mark.parametrize("value", ["false", "FALSE", " False ", "0", "no", "NO"])
def test_parse_bool_reads_every_spelling_of_false(value: str) -> None:
    assert _parse_bool(value) is False


@pytest.mark.parametrize("value", ["", "   ", "maybe", "2", "t"])
def test_parse_bool_refuses_anything_else(value: str) -> None:
    """The message quotes the cell, since the caller wraps it with the CSV line number."""
    with pytest.raises(ValueError, match="expected a boolean value"):
        _parse_bool(value)
