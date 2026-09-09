"""OCR columns on attachments and drafts (plan §3.10)

Replaces the placeholder ``attachments.ocr_json`` with the real result columns
and adds the review flags a pre-filled draft carries.

Revision ID: d3c4e5f60718
Revises: c2b3d4e5f607
Create Date: 2026-09-09
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = 'd3c4e5f60718'
down_revision = 'c2b3d4e5f607'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('attachments', schema=None) as batch_op:
        batch_op.add_column(sa.Column('ocr_result_json', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('ocr_model', sa.String(length=128), nullable=True))
        batch_op.add_column(sa.Column('ocr_duration_ms', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('ocr_error', sa.Text(), nullable=True))
        batch_op.create_index(
            batch_op.f('ix_attachments_ocr_status'), ['ocr_status'], unique=False
        )
        batch_op.drop_column('ocr_json')

    with op.batch_alter_table('voucher_drafts', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('needs_review', sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.add_column(
            sa.Column('review_reasons_json', sa.Text(), nullable=False, server_default='[]')
        )


def downgrade() -> None:
    with op.batch_alter_table('voucher_drafts', schema=None) as batch_op:
        batch_op.drop_column('review_reasons_json')
        batch_op.drop_column('needs_review')

    with op.batch_alter_table('attachments', schema=None) as batch_op:
        batch_op.add_column(sa.Column('ocr_json', sa.Text(), nullable=True))
        batch_op.drop_index(batch_op.f('ix_attachments_ocr_status'))
        batch_op.drop_column('ocr_error')
        batch_op.drop_column('ocr_duration_ms')
        batch_op.drop_column('ocr_model')
        batch_op.drop_column('ocr_result_json')
