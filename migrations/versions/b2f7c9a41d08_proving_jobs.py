"""proving_jobs (async per-wallet RISC Zero proving jobs, Phase 2.3)

Revision ID: b2f7c9a41d08
Revises: 9a86bb72579f
Create Date: 2026-07-08 05:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2f7c9a41d08'
down_revision: Union[str, Sequence[str], None] = '9a86bb72579f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'proving_jobs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('stellar_address', sa.String(length=56), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('result', sa.JSON(), nullable=True),
        sa.Column('submission_mode', sa.String(length=32), nullable=True),
        sa.Column('error_detail', sa.String(length=512), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_proving_jobs_stellar_address'),
        'proving_jobs',
        ['stellar_address'],
        unique=False,
    )
    op.create_index(
        op.f('ix_proving_jobs_status'), 'proving_jobs', ['status'], unique=False
    )
    op.create_index(
        op.f('ix_proving_jobs_created_at'), 'proving_jobs', ['created_at'], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_proving_jobs_created_at'), table_name='proving_jobs')
    op.drop_index(op.f('ix_proving_jobs_status'), table_name='proving_jobs')
    op.drop_index(op.f('ix_proving_jobs_stellar_address'), table_name='proving_jobs')
    op.drop_table('proving_jobs')
