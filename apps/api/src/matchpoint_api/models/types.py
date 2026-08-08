import enum

import sqlalchemy


def str_enum(enum_cls: type[enum.StrEnum], name: str) -> sqlalchemy.Enum:
    """VARCHAR + CHECK column type for a StrEnum — the project convention for enums.

    Native Postgres enums cannot be altered inside a transactional migration, so
    enums are stored as plain strings constrained by a CHECK, keyed on the enum's
    values rather than its member names.
    """
    return sqlalchemy.Enum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        values_callable=lambda e: [m.value for m in e],
    )
