from sqlalchemy.orm import Session

from matchpoint_api.usernames import next_username, username_prefix
from tests.factories import make_coach, make_player

# The folding cases, each pinned for the rule it exercises rather than the name it
# uses: the prefix must come out the same for the same name on every machine, since
# the migration backfill carries a frozen copy of the same function.


def test_the_surname_prefers_consonants_and_the_first_name_reads_plainly() -> None:
    """The student-number scheme the issue decided on: Kabalin keeps its first letter
    then skips vowels to kbl, while Thomas is the plain first three letters."""
    assert username_prefix("Thomas", "Kabalin") == "kbltho"


def test_skipped_vowels_fill_in_when_the_consonants_run_short() -> None:
    assert username_prefix("Sam", "Lee") == "leesam"


def test_accents_fold_to_their_bare_letters() -> None:
    """NFKD splits the accent off, so Müller contributes its letters rather than
    losing the ü to the a-z filter."""
    assert username_prefix("José", "Müller") == "mlljos"


def test_punctuation_and_spaces_drop_out_before_folding() -> None:
    assert username_prefix("Mary Jane", "O'Brien") == "obrmar"
    assert username_prefix("Sam", "van der Merwe") == "vndsam"


def test_a_short_name_is_padded_to_keep_the_prefix_fixed_width() -> None:
    """The number always starts at the seventh character, which is what lets
    next_username parse the suffix without a separator."""
    assert username_prefix("Bo", "Li") == "lixbox"


def test_a_name_with_no_latin_letters_folds_to_the_placeholder() -> None:
    assert username_prefix("王", "李") == "xxxxxx"


def test_casefold_handles_one_to_many_letters() -> None:
    """ß casefolds to ss, and the surname rule then reads those as its consonants."""
    assert username_prefix("Jo", "Weiß") == "wssjox"


def test_the_prefix_is_always_six_characters() -> None:
    for first, last in [("A", "B"), ("", ""), ("Maximilian", "Oberholzer"), ("张伟", "!!!")]:
        assert len(username_prefix(first, last)) == 6


# next_username reads the database, so these run against real rows.


def test_the_first_holder_of_a_name_is_numbered_001(db_session: Session) -> None:
    assert next_username(db_session, "Sam", "Smith") == "smtsam001"


def test_a_namesake_takes_the_next_number(db_session: Session) -> None:
    make_player(db_session, first_name="Sam", last_name="Smith", username="smtsam001")

    assert next_username(db_session, "Sam", "Smith") == "smtsam002"


def test_numbering_resumes_past_the_highest_ever_minted_not_the_count(
    db_session: Session,
) -> None:
    """Max plus one rather than count plus one: after a middle namesake is deleted, a
    count would re-mint a username someone else may still be signing in with."""
    coach = make_coach(db_session)
    make_player(
        db_session, first_name="Sam", last_name="Smith", username="smtsam001", coach_id=coach.id
    )
    make_player(
        db_session, first_name="Sam", last_name="Smith", username="smtsam003", coach_id=coach.id
    )

    assert next_username(db_session, "Sam", "Smith") == "smtsam004"


def test_another_name_s_numbers_do_not_interfere(db_session: Session) -> None:
    make_player(db_session, first_name="Sam", last_name="Jones", username="jnssam005")

    assert next_username(db_session, "Sam", "Smith") == "smtsam001"


def test_past_999_the_number_widens_rather_than_wrapping(db_session: Session) -> None:
    make_player(db_session, first_name="Sam", last_name="Smith", username="smtsam999")

    assert next_username(db_session, "Sam", "Smith") == "smtsam1000"
