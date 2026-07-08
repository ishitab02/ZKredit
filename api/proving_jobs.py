"""Async proving-job store (Phase 2.3).

``POST /attest/{address}/prepare`` enqueues a job here and returns its id
immediately instead of blocking ~25s on the RISC Zero prove; a background task
runs the proof and writes the browser-signable co-sign result back.
``GET /attest/jobs/{id}`` reads it. Persisting job state in Postgres (rather than
in process memory) keeps the poll working across the API machine's requests and
leaves an audit trail; it also matches the ``get_session_factory`` DI pattern the
rest of the API already uses.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ml.data.models import ProvingJob

# Job status values (also stored as the ``status`` column).
QUEUED = "queued"
PROVING = "proving"
SUCCEEDED = "succeeded"
FAILED = "failed"


@dataclass(frozen=True)
class ProvingJobRecord:
    """A read-only projection of a proving job row."""

    id: str
    stellar_address: str
    status: str
    result: dict[str, Any] | None
    submission_mode: str | None
    error_detail: str | None
    created_at: datetime
    updated_at: datetime


def _to_record(row: ProvingJob) -> ProvingJobRecord:
    return ProvingJobRecord(
        id=row.id,
        stellar_address=row.stellar_address,
        status=row.status,
        result=row.result,
        submission_mode=row.submission_mode,
        error_detail=row.error_detail,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def create_job(
    session_factory: async_sessionmaker[AsyncSession],
    job_id: str,
    stellar_address: str,
) -> None:
    """Insert a ``queued`` job row."""
    async with session_factory() as session:
        session.add(
            ProvingJob(id=job_id, stellar_address=stellar_address, status=QUEUED)
        )
        await session.commit()


async def mark_proving(
    session_factory: async_sessionmaker[AsyncSession], job_id: str
) -> None:
    """Move a job to ``proving`` once the background task picks it up."""
    async with session_factory() as session:
        job = await session.get(ProvingJob, job_id)
        if job is not None:
            job.status = PROVING
            await session.commit()


async def finish_job(
    session_factory: async_sessionmaker[AsyncSession],
    job_id: str,
    *,
    status: str,
    result: dict[str, Any] | None = None,
    submission_mode: str | None = None,
    error_detail: str | None = None,
) -> None:
    """Write the terminal state (``succeeded`` or ``failed``) and payload."""
    async with session_factory() as session:
        job = await session.get(ProvingJob, job_id)
        if job is None:
            return
        job.status = status
        job.result = result
        job.submission_mode = submission_mode
        job.error_detail = error_detail
        await session.commit()


async def read_job(
    session_factory: async_sessionmaker[AsyncSession], job_id: str
) -> ProvingJobRecord | None:
    """Read one job by id, or ``None`` if it does not exist."""
    async with session_factory() as session:
        row = (
            await session.execute(select(ProvingJob).where(ProvingJob.id == job_id))
        ).scalar_one_or_none()
    return _to_record(row) if row is not None else None
