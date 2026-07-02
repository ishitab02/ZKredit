"""Idempotent Stellar account ingestion from Horizon into the Postgres cache.

Pulls an account snapshot plus its operation history and upserts both into the
cache. Re-running ``ingest_wallet`` for the same address is a no-op beyond
refreshing the account snapshot — operations are immutable and keyed by Horizon
id, so duplicates are never created.

Horizon pagination is followed via ``_links.next.href`` until exhausted or the
``INGEST_MAX_OPERATIONS`` cap is reached (the DG3 fail-action 1-year cap maps to
this limit plus a date filter once BigQuery is out of the picture).

Usage::

    from ml.data.db import create_engine, create_session_factory, init_db
    from ml.data.stellar_ingest import StellarIngestor

    engine = create_engine()
    await init_db(engine)
    async with StellarIngestor(create_session_factory(engine)) as ingestor:
        result = await ingestor.ingest_wallet("GBQ...XYZ")
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from types import TracebackType
from typing import Any, Self

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from ml.config import get_settings
from ml.data.models import Account, Operation

_HORIZON_PAGE_LIMIT = 200  # Horizon's max page size for operations.


@dataclass(frozen=True)
class IngestResult:
    """Summary of one ingestion run."""

    stellar_address: str
    account_found: bool
    operations_seen: int
    operations_new: int


def _parse_ts(value: str | None) -> datetime | None:
    """Parse a Horizon ISO-8601 timestamp (``...Z``) to an aware datetime."""
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class StellarIngestor:
    """Pulls account history from Horizon and caches it idempotently in Postgres."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        client: httpx.AsyncClient | None = None,
        horizon_url: str | None = None,
        max_operations: int | None = None,
    ) -> None:
        settings = get_settings()
        self._session_factory = session_factory
        self._horizon_url = (horizon_url or settings.horizon_url).rstrip("/")
        self._max_operations = max_operations or settings.ingest_max_operations
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(base_url=self._horizon_url, timeout=30.0)

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if self._owns_client:
            await self._client.aclose()

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=0.5, max=8),
        reraise=True,
    )
    async def _get(self, url: str) -> httpx.Response:
        """GET with retry on transport errors. ``url`` may be absolute or relative."""
        response = await self._client.get(url)
        response.raise_for_status()
        return response

    async def fetch_account(self, address: str) -> dict[str, Any] | None:
        """Return the Horizon account record, or ``None`` if it does not exist (404)."""
        try:
            response = await self._get(f"/accounts/{address}")
        except httpx.HTTPStatusError as err:
            if err.response.status_code == 404:
                return None
            raise
        data: dict[str, Any] = response.json()
        return data

    async def fetch_operations(self, address: str) -> list[dict[str, Any]]:
        """Return up to ``max_operations`` operations, oldest first, following pagination."""
        operations: list[dict[str, Any]] = []
        url: str | None = f"/accounts/{address}/operations?order=asc&limit={_HORIZON_PAGE_LIMIT}"
        while url and len(operations) < self._max_operations:
            response = await self._get(url)
            payload: dict[str, Any] = response.json()
            records: list[dict[str, Any]] = payload.get("_embedded", {}).get("records", [])
            if not records:
                break
            operations.extend(records)
            url = payload.get("_links", {}).get("next", {}).get("href")
        return operations[: self._max_operations]

    async def ingest_wallet(self, address: str) -> IngestResult:
        """Fetch and idempotently cache an account and its operations."""
        account_record = await self.fetch_account(address)
        if account_record is None:
            return IngestResult(address, account_found=False, operations_seen=0, operations_new=0)

        operation_records = await self.fetch_operations(address)
        new_count = await self._persist(address, account_record, operation_records)
        return IngestResult(
            stellar_address=address,
            account_found=True,
            operations_seen=len(operation_records),
            operations_new=new_count,
        )

    async def _persist(
        self,
        address: str,
        account_record: dict[str, Any],
        operation_records: list[dict[str, Any]],
    ) -> int:
        """Upsert account + operations. Returns the count of newly inserted operations."""
        new_count = 0
        async with self._session_factory() as session:
            await session.merge(
                Account(
                    stellar_address=address,
                    sequence=account_record.get("sequence"),
                    subentry_count=account_record.get("subentry_count"),
                    last_modified_time=_parse_ts(account_record.get("last_modified_time")),
                    raw=account_record,
                )
            )
            for record in operation_records:
                op_id = str(record["id"])
                existing = await session.get(Operation, op_id)
                if existing is None:
                    new_count += 1
                await session.merge(
                    Operation(
                        op_id=op_id,
                        stellar_address=address,
                        type=record.get("type", "unknown"),
                        type_i=record.get("type_i"),
                        transaction_hash=record.get("transaction_hash"),
                        created_at=_parse_ts(record.get("created_at")),
                        raw=record,
                    )
                )
            await session.commit()
        return new_count
