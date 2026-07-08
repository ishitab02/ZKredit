"""Identity-group membership routes (Phase 4.3).

The frontend registers a wallet into an identity group on-chain
(``WalletIdentity.register_wallet``, proof-gated). Because the contract has no
"list members" view, the client also records the (wallet, commitment) pair here
so the backend's group re-score trigger knows which wallets to re-score together.
Recording a membership enqueues a group re-score so the shared score folds the
new member in immediately.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from api.deps import get_session_factory
from api.identity import store
from api.services.group_rescore import enqueue_group_rescore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/identity", tags=["identity"])

SessionFactoryDep = Annotated[async_sessionmaker[AsyncSession], Depends(get_session_factory)]

_STELLAR_ADDRESS_PATTERN = r"^G[A-Z2-7]{55}$"
_COMMITMENT_PATTERN = r"^[0-9a-fA-F]{64}$"


class MembershipRequest(BaseModel):
    wallet_address: str = Field(pattern=_STELLAR_ADDRESS_PATTERN)
    commitment: str = Field(pattern=_COMMITMENT_PATTERN)


class MembershipResponse(BaseModel):
    wallet_address: str
    commitment: str
    members: list[str]


class GroupMembersResponse(BaseModel):
    commitment: str
    members: list[str]


@router.post("/membership", response_model=MembershipResponse)
async def record_membership(
    payload: MembershipRequest, session_factory: SessionFactoryDep
) -> MembershipResponse:
    """Record a wallet's group membership and trigger a group re-score."""
    await store.record_membership(
        session_factory,
        wallet_address=payload.wallet_address,
        commitment=payload.commitment,
    )
    members = await store.members_for_commitment(session_factory, payload.commitment)
    # A new/changed member changes the group's combined history — re-score now.
    await enqueue_group_rescore(session_factory, payload.commitment)
    return MembershipResponse(
        wallet_address=payload.wallet_address,
        commitment=payload.commitment,
        members=members,
    )


@router.get("/group/{commitment}/members", response_model=GroupMembersResponse)
async def group_members(
    commitment: str, session_factory: SessionFactoryDep
) -> GroupMembersResponse:
    """List the wallets bound to an identity commitment."""
    members = await store.members_for_commitment(session_factory, commitment)
    return GroupMembersResponse(commitment=commitment, members=members)
