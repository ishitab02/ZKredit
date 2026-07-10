from types import SimpleNamespace

import api.contract_stub as contract


def test_live_cosign_does_not_require_demo_fixture(monkeypatch, tmp_path) -> None:
    settings = SimpleNamespace(
        contract_id_risk_attestation="C" + "A" * 55,
        attestor_seed="unused-test-seed",
        attestor_address="G" + "A" * 55,
        attestation_ttl_seconds=3600,
        soroban_rpc_url="https://rpc.test",
        soroban_network_passphrase="Test SDF Network ; September 2015",
    )
    captured: dict[str, bytes] = {}

    def build_xdr(**kwargs) -> str:
        captured["seal"] = kwargs["seal"]
        captured["journal"] = kwargs["journal"]
        return "partial-xdr"

    monkeypatch.setattr(contract, "get_settings", lambda: settings)
    monkeypatch.setattr(contract, "_RISC0_FIXTURES", tmp_path / "missing")
    monkeypatch.setattr(contract, "ChainAttestationParams", lambda **kwargs: kwargs)
    monkeypatch.setattr(contract, "build_risc0_attestation_cosigned_xdr", build_xdr)

    params = contract.AttestationParams(
        stellar_address="G" + "B" * 55,
        risk_bucket=2,
        confidence_bps=8300,
        full_model_hash="11" * 32,
        distilled_model_hash="22" * 32,
        proof_hash="33" * 32,
        zk_verified=False,
    )
    result = contract.prepare_attestation_submission(
        params, seal=b"live-seal", journal=b"live-journal"
    )

    assert result.submission_mode == "live_cosign"
    assert result.partial_xdr == "partial-xdr"
    assert captured == {"seal": b"live-seal", "journal": b"live-journal"}
