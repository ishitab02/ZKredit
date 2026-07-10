"""Didit KYC provider (Phase 3.2).

Didit ([didit.me](https://didit.me/products/free-kyc/)) — 500 free verifications/
month, full ID + passive liveness + face match, Travel Rule/IVMS-101 for crypto —
chosen over Sumsub to avoid a standing bill before grants.

Grounded in Didit's v3 Sessions API and webhook docs: webhooks carry
HMAC-SHA256 ``X-Signature-V2`` (with raw-body and simple-signature fallbacks),
an ``X-Timestamp`` replay window, and a terminal ``decision`` whose
``id_verifications`` array holds ``document_number`` + ``issuing_state``
(ISO-3166 alpha-3). We tag each session with the identity ``commitment`` via
``vendor_data`` and read it back.

The extraction remains defensive so a small payload-shape difference degrades to
"document not found → not approved" rather than a crash. A real Didit sandbox
webhook should still be replayed through the production webhook URL before the
first paid verification.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from collections.abc import Mapping
from typing import Any

import httpx

from api.kyc.provider import IdentityDocument, KycEvent, KycProvider, KycSession

# Confirm against the sandbox; kept as constants so a doc change is a one-line fix.
_DEFAULT_API_BASE = "https://verification.didit.me"
_SESSION_PATH = "/v3/session/"
_DECISION_PATH = "/v3/session/{session_id}/decision/"
_SIGNATURE_HEADER = "x-signature"
_SIGNATURE_V2_HEADER = "x-signature-v2"
_SIGNATURE_SIMPLE_HEADER = "x-signature-simple"
_TIMESTAMP_HEADER = "x-timestamp"
_MAX_WEBHOOK_AGE_SECONDS = 300

# Didit status strings → our normalized set.
_STATUS_MAP = {
    "approved": "approved",
    "declined": "declined",
    "in review": "in_review",
    "in_review": "in_review",
    "abandoned": "abandoned",
    "expired": "abandoned",
    "kyc expired": "abandoned",
    "resubmitted": "pending",
    "awaiting user": "pending",
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
            body["callback_method"] = "both"
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
        """Verify a Didit webhook and reject stale/replayed events.

        Didit v3 recommends ``X-Signature-V2`` over canonical JSON, but also
        sends raw-body and simple-signature variants. Supporting all three
        keeps the endpoint compatible with configured webhook versions while
        always requiring the timestamp freshness check.
        """
        values = {key.lower(): value.strip() for key, value in headers.items()}
        timestamp = values.get(_TIMESTAMP_HEADER)
        if not timestamp:
            return False
        try:
            if abs(int(time.time()) - int(timestamp)) > _MAX_WEBHOOK_AGE_SECONDS:
                return False
        except ValueError:
            return False

        provided_v2 = values.get(_SIGNATURE_V2_HEADER)
        if provided_v2:
            try:
                payload = json.loads(raw_body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                payload = None
            if payload is not None:
                canonical = json.dumps(
                    _shorten_integral_floats(payload),
                    sort_keys=True,
                    separators=(",", ":"),
                    ensure_ascii=False,
                ).encode("utf-8")
                expected = hmac.new(self._webhook_secret, canonical, hashlib.sha256).hexdigest()
                if hmac.compare_digest(expected, provided_v2):
                    return True

        provided_raw = values.get(_SIGNATURE_HEADER)
        if provided_raw:
            expected = hmac.new(self._webhook_secret, raw_body, hashlib.sha256).hexdigest()
            if hmac.compare_digest(expected, provided_raw):
                return True

        provided_simple = values.get(_SIGNATURE_SIMPLE_HEADER)
        if provided_simple:
            try:
                payload = json.loads(raw_body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                return False
            simple = ":".join(
                str(payload.get(name, ""))
                for name in ("timestamp", "session_id", "status", "webhook_type")
            ).encode("utf-8")
            expected = hmac.new(self._webhook_secret, simple, hashlib.sha256).hexdigest()
            return hmac.compare_digest(expected, provided_simple)
        return False

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


def _shorten_integral_floats(value: Any) -> Any:
    """Match Didit's V2 canonical JSON rule for integral float values."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, list):
        return [_shorten_integral_floats(item) for item in value]
    if isinstance(value, dict):
        return {key: _shorten_integral_floats(item) for key, item in value.items()}
    return value


def _extract_document(decision: Any) -> IdentityDocument | None:
    """Pull document_number + issuing country from a decision, if present.

    Defensive to shape: accepts the fields under ``id_verification`` or at the
    decision root, and the country as ``issuing_state``/``issuing_country``.
    """
    if not isinstance(decision, dict):
        return None
    idvs = decision.get("id_verifications")
    if isinstance(idvs, list):
        # v3 represents document checks as an array because a workflow can
        # contain multiple ID-verification nodes.
        for candidate in idvs:
            if not isinstance(candidate, dict):
                continue
            number = candidate.get("document_number") or candidate.get("document_no")
            country = candidate.get("issuing_state") or candidate.get("issuing_country")
            if number and country:
                return IdentityDocument(doc_number=str(number), issuing_country=str(country))

    # Keep the v2 singular shape as a compatibility fallback for replayed
    # sandbox fixtures during migration.
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
