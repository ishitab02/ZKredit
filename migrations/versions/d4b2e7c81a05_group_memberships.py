"""group_memberships (identity-group re-score mirror, Phase 4.3)

Revision ID: d4b2e7c81a05
Revises: c3a1e5d92f14
Create Date: 2026-07-09 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4b2e7c81a05'
down_revision: Union[str, Sequence[str], None] = 'c3a1e5d92f14'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'group_memberships',
        sa.Column('wallet_address', sa.String(length=56), nullable=False),
        sa.Column('commitment', sa.String(length=64), nullable=False),
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
        sa.PrimaryKeyConstraint('wallet_address'),
    )
    op.create_index(
        op.f('ix_group_memberships_commitment'),
        'group_memberships',
        ['commitment'],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_group_memberships_commitment'), table_name='group_memberships')
    op.drop_table('group_memberships')
