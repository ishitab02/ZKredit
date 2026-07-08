"""Provider-agnostic KYC seam (Phase 3.2).

The abstraction is deliberately modeled as ``webhook_event -> normalize -> KycEvent``
where ``normalize`` MAY perform a synchronous verification-detail pull (some
providers put the document fields in the webhook, others require a follow-up API
call). Keeping that inside ``normalize`` means the rest of the app only ever sees
a fully-populated :class:`KycEvent`, so swapping providers is one subclass — as
the Sumsub→Didit change proved.

The :func:`compute_nullifier` derivation is the load-bearing Sybil primitive and
lives here (provider-independent): the same verified human always yields the same
opaque nullifier, which ``WalletIdentity::bind_kyc`` allows to bind exactly one
identity commitment. Raw document fields are hashed under a secret pepper and
never persisted.
"""

from __future__ import annotations

import hashlib
import hmac
import unicodedata
from abc import ABC, abstractmethod
from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class IdentityDocument:
    """The two low-entropy identity fields the nullifier is derived from.

    ``issuing_country`` is normalized to ISO 3166-1 alpha-3 by the provider layer.
    Instances are used transiently during webhook handling and never stored.
    """

    doc_number: str
    issuing_country: str


@dataclass(frozen=True)
class KycSession:
    """A started verification session to hand back to the frontend."""

    session_id: str
    url: str


@dataclass(frozen=True)
class KycEvent:
    """A normalized, provider-agnostic verification result."""

    provider_session_id: str
    # Normalized to: approved | declined | in_review | pending | abandoned.
    status: str
    # The identity commitment we tagged the session with (vendor_data), if echoed.
    commitment: str | None
    # Present only on an approved event; carries the fields the nullifier needs.
    document: IdentityDocument | None
    # The provider's own duplicate-detection signal, when it surfaces one.
    dedupe_flag: bool = False


class KycProvider(ABC):
    """One KYC vendor behind the app's stable interface."""

    @abstractmethod
    async def create_session(self, commitment: str) -> KycSession:
        """Start a verification tagged with ``commitment`` (as vendor_data)."""

    @abstractmethod
    def verify_signature(self, raw_body: bytes, headers: Mapping[str, str]) -> bool:
        """True iff the webhook body authentically came from the provider."""

    @abstractmethod
    async def normalize(self, raw_body: bytes) -> KycEvent:
        """Parse a webhook body into a :class:`KycEvent`.

        May perform a synchronous verification-detail pull to populate
        :attr:`KycEvent.document` when the webhook itself omits it.
        """


def _normalize_field(value: str) -> str:
    """Canonicalize a document field so trivial format variants collide.

    NFKC + uppercase + drop every non-alphanumeric char, so ``"AB-12 345"`` and
    ``"ab12345"`` yield the same nullifier input. Applied identically to country
    and number.
    """
    folded = unicodedata.normalize("NFKC", value).upper()
    return "".join(ch for ch in folded if ch.isalnum())


def compute_nullifier(pepper: bytes, document: IdentityDocument) -> bytes:
    """Opaque 32-byte Sybil nullifier for a verified document.

    ``HMAC-SHA256(pepper, normalize(country) || 0x1f || normalize(number))``. The
    same human → the same nullifier → at most one on-chain identity group
    (``bind_kyc``). The secret ``pepper`` defeats precomputation despite doc
    numbers being low-entropy/near-enumerable; the raw fields are never stored,
    only this digest. The ``0x1f`` unit separator makes the two fields
    unambiguous (so ``("AB","12")`` and ``("A","B12")`` cannot collide).
    """
    country = _normalize_field(document.issuing_country)
    number = _normalize_field(document.doc_number)
    message = f"{country}\x1f{number}".encode()
    return hmac.new(pepper, message, hashlib.sha256).digest()
