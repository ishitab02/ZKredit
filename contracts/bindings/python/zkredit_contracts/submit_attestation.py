"""Submit ZKredit attestations to the RiskAttestation contract.

The helper uses the hash-anchored path (`attest_with_hash`) as the default,
because the on-chain Groth16 verifier is not guaranteed to be available in
Soroban testnet at the time of writing (DG1 fallback).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from stellar_sdk import (
    Address as StellarAddress,
    Asset,
    Keypair,
    Network,
    SorobanServer,
    TransactionBuilder,
    xdr,
)
from stellar_sdk.contract import ContractClient


@dataclass(frozen=True)
class AttestationParams:
    """On-chain attestation payload.

    Fields mirror the contract's `AttestationData` struct.  Only a bucket,
    confidence, hashes, timestamps, attestor and wallet are stored on-chain;
    no raw wallet features are included.
    """

    wallet: str
    risk_bucket: int
    confidence: int
    full_model_hash: bytes
    distilled_model_hash: bytes
    proof_or_hash: bytes
    zk_verified: bool
    attestor: str
    issued_at: int
    expires_at: int
    kyc_verified: bool = False
    identity_commitment: Optional[bytes] = None

    def __post_init__(self) -> None:
        for name, value, length in (
            ("full_model_hash", self.full_model_hash, 32),
            ("distilled_model_hash", self.distilled_model_hash, 32),
            ("proof_or_hash", self.proof_or_hash, 32),
        ):
            if not isinstance(value, (bytes, bytearray)) or len(value) != length:
                raise ValueError(f"{name} must be {length} bytes")


def _build_attestation_scval(params: AttestationParams):
    """Build a Soroban SCVal map matching `AttestationData`."""
    from stellar_sdk.contract import xdr as contract_xdr
    from stellar_sdk import scval

    def hash_val(data: bytes):
        return scval.to_bytes(scval.to_xdr_bytes(data))

    map_ = {
        scval.to_symbol("wallet"): scval.to_address(params.wallet),
        scval.to_symbol("risk_bucket"): scval.to_uint32(params.risk_bucket),
        scval.to_symbol("confidence"): scval.to_uint32(params.confidence),
        scval.to_symbol("full_model_hash"): hash_val(params.full_model_hash),
        scval.to_symbol("distilled_model_hash"): hash_val(params.distilled_model_hash),
        scval.to_symbol("proof_or_hash"): hash_val(params.proof_or_hash),
        scval.to_symbol("zk_verified"): scval.to_bool(params.zk_verified),
        scval.to_symbol("attestor"): scval.to_address(params.attestor),
        scval.to_symbol("issued_at"): scval.to_uint64(params.issued_at),
        scval.to_symbol("expires_at"): scval.to_uint64(params.expires_at),
        scval.to_symbol("kyc_verified"): scval.to_bool(params.kyc_verified),
    }

    if params.identity_commitment:
        map_[scval.to_symbol("identity_commitment")] = scval.to_some(
            hash_val(params.identity_commitment)
        )
    else:
        map_[scval.to_symbol("identity_commitment")] = scval.to_void()

    return scval.to_map(map_)


def _base64_transaction_envelope(tx: xdr.TransactionEnvelope) -> str:
    return tx.to_xdr().decode("utf-8")


def submit_attestation(
    *,
    contract_id: str,
    params: AttestationParams,
    attestor_seed: str,
    rpc_url: str = "https://soroban-testnet.stellar.org",
    network_passphrase: str = "Test SDF Network ; September 2015",
    timeout: int = 30,
) -> str:
    """Submit an attestation using the default hash-anchored path.

    Returns the transaction hash on success.  Raises on failure.
    """
    return submit_attestation_hash(
        contract_id=contract_id,
        params=params,
        attestor_seed=attestor_seed,
        rpc_url=rpc_url,
        network_passphrase=network_passphrase,
        timeout=timeout,
    )


def submit_attestation_hash(
    *,
    contract_id: str,
    params: AttestationParams,
    attestor_seed: str,
    rpc_url: str = "https://soroban-testnet.stellar.org",
    network_passphrase: str = "Test SDF Network ; September 2015",
    timeout: int = 30,
) -> str:
    """Call `RiskAttestation.attest_with_hash(wallet, data)`."""
    keypair = Keypair.from_secret(attestor_seed)
    server = SorobanServer(rpc_url)
    source = server.load_account(keypair.public_key)

    wallet_address = StellarAddress(params.wallet)
    data_val = _build_attestation_scval(params)

    tx = (
        TransactionBuilder(
            source_account=source,
            network_passphrase=network_passphrase,
            base_fee=100000,
        )
        .set_timeout(timeout)
        .append_contract_call_op(
            contract_id=contract_id,
            function_name="attest_with_hash",
            parameters=[wallet_address.to_xdr_scval(), data_val],
        )
        .build()
    )

    tx.sign(keypair)
    response = server.submit_transaction(tx)
    return response["hash"]


def submit_attestation_proof(
    *,
    contract_id: str,
    params: AttestationParams,
    proof_bytes: bytes,
    attestor_seed: str,
    rpc_url: str = "https://soroban-testnet.stellar.org",
    network_passphrase: str = "Test SDF Network ; September 2015",
    timeout: int = 30,
) -> str:
    """Call `RiskAttestation.attest_with_proof(wallet, data, proof_bytes)`."""
    keypair = Keypair.from_secret(attestor_seed)
    server = SorobanServer(rpc_url)
    source = server.load_account(keypair.public_key)

    wallet_address = StellarAddress(params.wallet)
    data_val = _build_attestation_scval(params)

    tx = (
        TransactionBuilder(
            source_account=source,
            network_passphrase=network_passphrase,
            base_fee=100000,
        )
        .set_timeout(timeout)
        .append_contract_call_op(
            contract_id=contract_id,
            function_name="attest_with_proof",
            parameters=[
                wallet_address.to_xdr_scval(),
                data_val,
                xdr.SCVal.from_xdr(proof_bytes),
            ],
        )
        .build()
    )

    tx.sign(keypair)
    response = server.submit_transaction(tx)
    return response["hash"]
