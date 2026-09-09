"""stock valuations for the configurable gross-profit formula (plan §3.9)

Revision ID: c2b3d4e5f607
Revises: b1a2c3d4e5f6
Create Date: 2026-09-09
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = 'c2b3d4e5f607'
down_revision = 'b1a2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'stock_valuations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('as_on', sa.Date(), nullable=False),
        sa.Column('closing_value', sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column('source', sa.String(length=16), nullable=False),
        sa.Column('synced_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('stock_valuations', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_stock_valuations_as_on'), ['as_on'], unique=True
        )


def downgrade() -> None:
    with op.batch_alter_table('stock_valuations', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_stock_valuations_as_on'))
    op.drop_table('stock_valuations')
