"""KYC provider integration (Phase 3.2/3.3).

``provider.py`` is the provider-agnostic seam (``KycProvider`` + the normalized
event/document types + the Sybil ``nullifier`` derivation); ``didit.py`` is the
concrete Didit implementation. Nothing outside this package should know which
vendor is wired — the Sumsub→Didit switch that motivated the abstraction touched
only ``didit.py``.
"""
