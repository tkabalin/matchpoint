"""add a token stage to password resets

Revision ID: 4b2ca7d1e6f3
Revises: b1d7c4e9a305
Create Date: 2026-08-17 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4b2ca7d1e6f3"
down_revision: str | Sequence[str] | None = "b1d7c4e9a305"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # email_verifications' pair of hashes, arriving on a table that shipped with one
    # (#149): a row now holds either the emailed code or the proof it was answered.
    op.add_column("password_resets", sa.Column("token_hash", sa.String(length=64), nullable=True))
    op.alter_column(
        "password_resets", "otp_hash", existing_type=sa.String(length=64), nullable=True
    )
    # Named as Postgres names the same constraint when a create_table declares it
    # inline, so this table's schema reads like email_verifications'.
    op.create_unique_constraint("password_resets_token_hash_key", "password_resets", ["token_hash"])
    # By hand, and it would have to be: autogenerate compares CHECK constraints by
    # name only, so this condition would never be diffed.
    op.create_check_constraint(
        "password_reset_one_secret", "password_resets", "num_nonnulls(otp_hash, token_hash) = 1"
    )


def downgrade() -> None:
    op.drop_constraint("password_reset_one_secret", "password_resets", type_="check")
    op.drop_column("password_resets", "token_hash")
    # The rows that only the token stage could hold. Without this the NOT NULL below
    # cannot be restored, and a downgrade that raises is one nobody can run: a reset
    # part-way through is a ten-minute credential, so dropping it costs its owner one
    # more forgot-password.
    op.execute("DELETE FROM password_resets WHERE otp_hash IS NULL")
    op.alter_column(
        "password_resets", "otp_hash", existing_type=sa.String(length=64), nullable=False
    )
