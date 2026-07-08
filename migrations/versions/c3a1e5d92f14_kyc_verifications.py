"""kyc_verifications (Sybil nullifier registry mirror, Phase 3.3)

Revision ID: c3a1e5d92f14
Revises: b2f7c9a41d08
Create Date: 2026-07-08 06:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3a1e5d92f14'
down_revision: Union[str, Sequence[str], None] = 'b2f7c9a41d08'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'kyc_verifications',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('commitment', sa.String(length=64), nullable=False),
        sa.Column('nullifier', sa.String(length=64), nullable=True),
        sa.Column('provider_session_id', sa.String(length=128), nullable=False),
        sa.Column('dedupe_flag', sa.Boolean(), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('bind_tx_hash', sa.String(length=64), nullable=True),
        sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_kyc_verifications_commitment'), 'kyc_verifications', ['commitment'], unique=False
    )
    op.create_index(
        op.f('ix_kyc_verifications_nullifier'), 'kyc_verifications', ['nullifier'], unique=True
    )
    op.create_index(
        op.f('ix_kyc_verifications_status'), 'kyc_verifications', ['status'], unique=False
    )
    op.create_index(
        op.f('ix_kyc_verifications_created_at'), 'kyc_verifications', ['created_at'], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_kyc_verifications_created_at'), table_name='kyc_verifications')
    op.drop_index(op.f('ix_kyc_verifications_status'), table_name='kyc_verifications')
    op.drop_index(op.f('ix_kyc_verifications_nullifier'), table_name='kyc_verifications')
    op.drop_index(op.f('ix_kyc_verifications_commitment'), table_name='kyc_verifications')
    op.drop_table('kyc_verifications')
