"""vendor ledger creation (plan §3.8)

Adds ``ledgers.source`` ('tally' | 'talai') and
``voucher_drafts.generated_ledger_xml`` (the dry-run Import Ledger envelope).

Revision ID: b1a2c3d4e5f6
Revises: 86cc864bb842
Create Date: 2026-09-09
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = 'b1a2c3d4e5f6'
down_revision = '86cc864bb842'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('ledgers', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('source', sa.String(length=16), nullable=False, server_default='tally')
        )
        batch_op.create_index(batch_op.f('ix_ledgers_source'), ['source'], unique=False)

    with op.batch_alter_table('voucher_drafts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('generated_ledger_xml', sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('voucher_drafts', schema=None) as batch_op:
        batch_op.drop_column('generated_ledger_xml')

    with op.batch_alter_table('ledgers', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_ledgers_source'))
        batch_op.drop_column('source')
