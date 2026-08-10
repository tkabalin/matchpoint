import enum

import sqlalchemy


def str_enum(enum_cls: type[enum.StrEnum], name: str) -> sqlalchemy.Enum:
    """VARCHAR + CHECK column type for a StrEnum — the project convention for enums.

    Postgres offers no way to remove a value from a native enum, so adding one
    could never be rolled back and any migration touching an enum would ship a
    downgrade that cannot do what it claims. A CHECK constraint is editable in
    both directions, so enums are stored as plain strings constrained by one,
    keyed on the enum's values rather than its member names.
    """
    return sqlalchemy.Enum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        values_callable=lambda e: [m.value for m in e],
    )
