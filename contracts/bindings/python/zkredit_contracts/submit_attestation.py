"""Submit ZKredit attestations to the RiskAttestation contract.

The helper's ``attest_with_hash`` path hash-anchors without an on-chain proof.
The RISC Zero -> Groth16 (BN254) verifier IS live on Soroban
(``attest_with_risc0``, validated on testnet; BN254 host functions are native on
mainnet since Protocol 25) — use the co-sign path below for real ZK attestations.

Interactive co-sign path (``build_risc0_attestation_cosigned_xdr``):
``attest_with_risc0`` (and the other ``attest_*`` fns) require BOTH
``wallet.require_auth()`` and ``data.attestor.require_auth()``. A headless
attestor service holds only the attestor key, so it cannot sign for an
arbitrary wallet. The builder below produces a transaction with the WALLET as
source (its auth is a source-account credential, satisfied later by the
wallet's own envelope signature) and signs ONLY the attestor's Soroban
authorization entry server-side. The returned XDR is handed to the wallet
(e.g. Freighter in the browser), which signs the envelope and submits.
"""

from __future__ import annotations

from dataclasses import dataclass

from stellar_sdk import Address as StellarAddress
from stellar_sdk import Keypair, SorobanServer, TransactionBuilder, scval, xdr
from stellar_sdk.auth import authorize_entry


@dataclass(frozen=True)
class AttestationParams:
    """On-chain attestation payload.

    Fields mirror the contract's ``AttestationData`` struct.  Only a bucket,
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
    identity_commitment: bytes | None = None

    def __post_init__(self) -> None:
        for name, value, length in (
            ("full_model_hash", self.full_model_hash, 32),
            ("distilled_model_hash", self.distilled_model_hash, 32),
            ("proof_or_hash", self.proof_or_hash, 32),
        ):
            if not isinstance(value, (bytes, bytearray)) or len(value) != length:
                raise ValueError(f"{name} must be {length} bytes")


def _build_attestation_scval(params: AttestationParams):
    """Build a Soroban SCVal map matching ``AttestationData``.

    A ``#[contracttype]`` struct is encoded as an SCMap whose keys are the field
    symbols and whose values are the SCVal of each field. ``Option<BytesN<32>>``
    is encoded as the inner value for ``Some`` and as ``Void`` for ``None`` — there
    is no separate "some" wrapper in Soroban's value model.
    """
    from stellar_sdk import scval

    def hash_val(data: bytes):
        return scval.to_bytes(data)

    identity_commitment = (
        hash_val(params.identity_commitment)
        if params.identity_commitment
        else scval.to_void()
    )

    return scval.to_map(
        {
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
            scval.to_symbol("identity_commitment"): identity_commitment,
        }
    )


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
    """Call ``RiskAttestation.attest_with_hash(wallet, data)``."""
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
        .append_invoke_contract_function_op(
            contract_id=contract_id,
            function_name="attest_with_hash",
            parameters=[wallet_address.to_xdr_sc_val(), data_val],
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
    """Call ``RiskAttestation.attest_with_proof(wallet, data, proof_bytes)``."""
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
        .append_invoke_contract_function_op(
            contract_id=contract_id,
            function_name="attest_with_proof",
            parameters=[
                wallet_address.to_xdr_sc_val(),
                data_val,
                xdr.SCVal.from_xdr(proof_bytes),
            ],
        )
        .build()
    )

    tx.sign(keypair)
    response = server.submit_transaction(tx)
    return response["hash"]


def build_risc0_attestation_cosigned_xdr(
    *,
    contract_id: str,
    wallet: str,
    params: AttestationParams,
    seal: bytes,
    journal: bytes,
    attestor_seed: str,
    rpc_url: str = "https://soroban-testnet.stellar.org",
    network_passphrase: str = "Test SDF Network ; September 2015",
    valid_ledgers: int = 120,
    timeout: int = 300,
) -> str:
    """Build an ``attest_with_risc0`` transaction the wallet can finish signing.

    The transaction's source account is ``wallet`` (so the wallet's own
    ``require_auth`` is a source-account credential covered by its envelope
    signature). The attestor's ``require_auth`` becomes an address credential,
    which this function signs server-side with ``attestor_seed`` via
    :func:`authorize_entry`.

    Returns a base-64 transaction envelope XDR that is fully authorized except
    for the wallet's envelope signature. Hand it to the wallet (Freighter
    ``signTransaction`` then submit, or ``server.send_transaction``). ``params``
    carries the attestor address + non-proven metadata; the contract overwrites
    the proven fields (bucket, confidence, identity commitment, model hash) from
    the verified journal.
    """
    attestor_kp = Keypair.from_secret(attestor_seed)
    server = SorobanServer(rpc_url)
    source = server.load_account(wallet)
    wallet_address = StellarAddress(wallet)
    data_val = _build_attestation_scval(params)

    tx = (
        TransactionBuilder(
            source_account=source,
            network_passphrase=network_passphrase,
            base_fee=100000,
        )
        .set_timeout(timeout)
        .append_invoke_contract_function_op(
            contract_id=contract_id,
            function_name="attest_with_risc0",
            parameters=[
                wallet_address.to_xdr_sc_val(),
                data_val,
                scval.to_bytes(seal),
                scval.to_bytes(journal),
            ],
        )
        .build()
    )

    # prepare_transaction runs the recording simulation and sets footprint,
    # resource fee, and the (unsigned) auth entries the invocation requires.
    prepared = server.prepare_transaction(tx)
    valid_until = server.get_latest_ledger().sequence + valid_ledgers

    signed_auth = []
    for entry in prepared.transaction.operations[0].auth:
        is_address_cred = (
            entry.credentials.type
            == xdr.SorobanCredentialsType.SOROBAN_CREDENTIALS_ADDRESS
        )
        if is_address_cred:
            # The only address credential here is the attestor's — sign it.
            signed_auth.append(
                authorize_entry(entry, attestor_kp, valid_until, network_passphrase)
            )
        else:
            # Source-account credential (the wallet) — the wallet's envelope
            # signature satisfies it; leave unchanged.
            signed_auth.append(entry)
    prepared.transaction.operations[0].auth = signed_auth

    return prepared.to_xdr()
