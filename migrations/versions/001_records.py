"""Versioned scenario/run/experiment metadata; immutable numerical artifacts."""
from alembic import op
import sqlalchemy as sa

revision = "001"
down_revision = None


def upgrade():
    # Allows adopting the explicitly supported local create_all bootstrap.
    if not sa.inspect(op.get_bind()).has_table("records"):
        op.create_table("records", sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("kind", sa.String(30), nullable=False),
            sa.Column("status", sa.String(30), nullable=False),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("payload", sa.Text(), nullable=False),
            sa.Column("created", sa.String(40), nullable=False))
        op.create_index("ix_records_kind", "records", ["kind"])
    if op.get_bind().dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS postgis")


def downgrade():
    raise RuntimeError("Destructive downgrade disabled; restore an approved backup instead.")
