"""Didit KYC provider (Phase 3.2).

Didit ([didit.me](https://didit.me/products/free-kyc/)) — 500 free verifications/
month, full ID + passive liveness + face match, Travel Rule/IVMS-101 for crypto —
chosen over Sumsub to avoid a standing bill before grants.

Grounded in Didit's v2 docs (https://docs.didit.me/integration/webhooks):
webhooks are HMAC-SHA256 signed with the destination's shared secret over the raw
body (``X-Signature``); a terminal event carries a ``decision`` whose
``id_verification`` holds ``document_number`` + ``issuing_state`` (ISO-3166
alpha-3). We tag each session with the identity ``commitment`` via ``vendor_data``
and read it back.

NOTE (per plan 3.2): the exact hostnames, paths, and JSON field nesting below are
from the docs and MUST be pinned against a real Didit **sandbox** session before
relying on them in production — sandbox is unmetered, so this costs nothing. The
extraction is written defensively (top-level or nested) so a small shape
difference degrades to "document not found → not approved" rather than a crash.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from collections.abc import Mapping
from typing import Any

import httpx

from api.kyc.provider import IdentityDocument, KycEvent, KycProvider, KycSession

# Confirm against the sandbox; kept as constants so a doc change is a one-line fix.
_DEFAULT_API_BASE = "https://verification.didit.me"
_SESSION_PATH = "/v2/session/"
_DECISION_PATH = "/v2/session/{session_id}/decision/"
_SIGNATURE_HEADER = "x-signature"

# Didit status strings → our normalized set.
_STATUS_MAP = {
    "approved": "approved",
    "declined": "declined",
    "in review": "in_review",
    "in_review": "in_review",
    "abandoned": "abandoned",
    "not started": "pending",
    "in progress": "pending",
}


class DiditProvider(KycProvider):
    def __init__(
        self,
        *,
        api_key: str,
        webhook_secret: str,
        workflow_id: str,
        api_base: str = _DEFAULT_API_BASE,
        callback_url: str | None = None,
    ) -> None:
        self._api_key = api_key
        self._webhook_secret = webhook_secret.encode()
        self._workflow_id = workflow_id
        self._api_base = api_base.rstrip("/")
        self._callback_url = callback_url

    def _headers(self) -> dict[str, str]:
        return {"x-api-key": self._api_key, "Content-Type": "application/json"}

    async def create_session(self, commitment: str) -> KycSession:
        body: dict[str, Any] = {
            "workflow_id": self._workflow_id,
            # Echoed back on the webhook so we can tie the result to the identity.
            "vendor_data": commitment,
        }
        if self._callback_url:
            body["callback"] = self._callback_url
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self._api_base}{_SESSION_PATH}", headers=self._headers(), json=body
            )
            resp.raise_for_status()
            data = resp.json()
        session_id = data.get("session_id") or data.get("id") or ""
        url = data.get("url") or data.get("verification_url") or ""
        return KycSession(session_id=str(session_id), url=str(url))

    def verify_signature(self, raw_body: bytes, headers: Mapping[str, str]) -> bool:
        # Header lookup is case-insensitive; Starlette lower-cases, but be safe.
        provided = None
        for key, value in headers.items():
            if key.lower() == _SIGNATURE_HEADER:
                provided = value
                break
        if not provided:
            return False
        expected = hmac.new(self._webhook_secret, raw_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, provided.strip())

    async def normalize(self, raw_body: bytes) -> KycEvent:
        payload = json.loads(raw_body)
        session_id = str(
            payload.get("session_id") or payload.get("session", {}).get("session_id") or ""
        )
        status = _normalize_status(payload.get("status"))
        commitment = payload.get("vendor_data") or payload.get("reference")

        decision = payload.get("decision")
        document = _extract_document(decision) if decision else None
        # Approved but the webhook omitted the document → pull the decision.
        if status == "approved" and document is None and session_id:
            decision = await self._fetch_decision(session_id)
            document = _extract_document(decision)

        return KycEvent(
            provider_session_id=session_id,
            status=status,
            commitment=str(commitment) if commitment is not None else None,
            document=document,
            dedupe_flag=_extract_dedupe(decision),
        )

    async def _fetch_decision(self, session_id: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{self._api_base}{_DECISION_PATH.format(session_id=session_id)}",
                headers=self._headers(),
            )
            resp.raise_for_status()
            return resp.json()


def _normalize_status(raw: Any) -> str:
    if not isinstance(raw, str):
        return "pending"
    return _STATUS_MAP.get(raw.strip().lower(), "pending")


def _extract_document(decision: Any) -> IdentityDocument | None:
    """Pull document_number + issuing country from a decision, if present.

    Defensive to shape: accepts the fields under ``id_verification`` or at the
    decision root, and the country as ``issuing_state``/``issuing_country``.
    """
    if not isinstance(decision, dict):
        return None
    idv = decision.get("id_verification")
    source = idv if isinstance(idv, dict) else decision
    number = source.get("document_number") or source.get("document_no")
    country = source.get("issuing_state") or source.get("issuing_country")
    if not number or not country:
        return None
    return IdentityDocument(doc_number=str(number), issuing_country=str(country))


def _extract_dedupe(decision: Any) -> bool:
    """Provider's own duplicate signal, if surfaced. Absent → False (nullifier
    is then the sole Sybil check; see plan 3.3 step 5)."""
    if not isinstance(decision, dict):
        return False
    warnings = decision.get("warnings") or []
    if isinstance(warnings, list):
        for w in warnings:
            if isinstance(w, dict) and "duplicate" in str(w.get("risk", "")).lower():
                return True
    aml = decision.get("aml")
    return bool(isinstance(aml, dict) and aml.get("duplicate_of"))
