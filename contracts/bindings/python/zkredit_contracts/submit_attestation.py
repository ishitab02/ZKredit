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

import time
from dataclasses import dataclass

from stellar_sdk import Address as StellarAddress
from stellar_sdk import Keypair, SorobanServer, TransactionBuilder, scval, xdr
from stellar_sdk.auth import authorize_entry
from stellar_sdk.soroban_rpc import GetTransactionStatus, SendTransactionStatus


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
            if not isinstance(value, bytes | bytearray) or len(value) != length:
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

    fields = {
        "wallet": scval.to_address(params.wallet),
        "risk_bucket": scval.to_uint32(params.risk_bucket),
        "confidence": scval.to_uint32(params.confidence),
        "full_model_hash": hash_val(params.full_model_hash),
        "distilled_model_hash": hash_val(params.distilled_model_hash),
        "proof_or_hash": hash_val(params.proof_or_hash),
        "zk_verified": scval.to_bool(params.zk_verified),
        "attestor": scval.to_address(params.attestor),
        "issued_at": scval.to_uint64(params.issued_at),
        "expires_at": scval.to_uint64(params.expires_at),
        "kyc_verified": scval.to_bool(params.kyc_verified),
        "identity_commitment": identity_commitment,
    }
    # Soroban requires struct SCMap entries sorted by key; stellar-sdk >=12's
    # ``scval.to_map`` preserves insertion order (it no longer sorts), so sort by
    # field symbol here or the host rejects it with "ScMap was not sorted by key".
    return scval.to_map(
        {scval.to_symbol(name): fields[name] for name in sorted(fields)}
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


def submit_bind_kyc(
    *,
    contract_id: str,
    attestor: str,
    commitment: bytes,
    nullifier: bytes,
    attestor_seed: str,
    rpc_url: str = "https://soroban-testnet.stellar.org",
    network_passphrase: str = "Test SDF Network ; September 2015",
    timeout: int = 30,
) -> str:
    """Call ``WalletIdentity.bind_kyc(attestor, commitment, nullifier)``.

    Attestor-authed only: the attestor is the source account, so its
    ``require_auth`` is a source-account credential covered by this signature —
    no interactive wallet co-sign is needed (unlike the attestation path).
    ``commitment``/``nullifier`` are 32-byte values. Returns the tx hash.
    """
    if len(commitment) != 32 or len(nullifier) != 32:
        raise ValueError("commitment and nullifier must be 32 bytes")
    keypair = Keypair.from_secret(attestor_seed)
    server = SorobanServer(rpc_url)
    source = server.load_account(keypair.public_key)

    tx = (
        TransactionBuilder(
            source_account=source,
            network_passphrase=network_passphrase,
            base_fee=100000,
        )
        .set_timeout(timeout)
        .append_invoke_contract_function_op(
            contract_id=contract_id,
            function_name="bind_kyc",
            parameters=[
                StellarAddress(attestor).to_xdr_sc_val(),
                scval.to_bytes(commitment),
                scval.to_bytes(nullifier),
            ],
        )
        .build()
    )

    # Soroban requires a recording simulation to assemble the footprint + resource
    # fees before signing, then send + poll (there is no one-shot submit for
    # Soroban txs). The attestor's require_auth is a source-account credential, so
    # signing the prepared envelope is all the auth bind_kyc needs.
    prepared = server.prepare_transaction(tx)
    prepared.sign(keypair)
    send = server.send_transaction(prepared)
    if send.status != SendTransactionStatus.PENDING:
        raise RuntimeError(
            f"bind_kyc send failed: {send.status}"
            f" {getattr(send, 'error_result_xdr', '') or ''}".rstrip()
        )
    # Manual poll (get_transaction + sleep) rather than SorobanServer.poll_transaction,
    # which isn't present in every stellar-sdk 12.x — this path runs in a worker
    # thread, so the blocking sleep is fine.
    deadline = time.monotonic() + timeout
    result = server.get_transaction(send.hash)
    while result.status == GetTransactionStatus.NOT_FOUND and time.monotonic() < deadline:
        time.sleep(1)
        result = server.get_transaction(send.hash)
    if result.status != GetTransactionStatus.SUCCESS:
        raise RuntimeError(f"bind_kyc did not succeed on-chain: {result.status}")
    return send.hash


def _prepare_sign_send_poll(server, tx, keypair, timeout: int, op_name: str) -> str:
    """Soroban submit lifecycle: simulate -> sign -> send -> poll. Returns tx hash.

    Shared by attestor-authed writes (no interactive co-sign). ``poll_transaction``
    isn't in every stellar-sdk 12.x, so poll manually with ``get_transaction``.
    """
    prepared = server.prepare_transaction(tx)
    prepared.sign(keypair)
    send = server.send_transaction(prepared)
    if send.status != SendTransactionStatus.PENDING:
        raise RuntimeError(
            f"{op_name} send failed: {send.status}"
            f" {getattr(send, 'error_result_xdr', '') or ''}".rstrip()
        )
    deadline = time.monotonic() + timeout
    result = server.get_transaction(send.hash)
    while result.status == GetTransactionStatus.NOT_FOUND and time.monotonic() < deadline:
        time.sleep(1)
        result = server.get_transaction(send.hash)
    if result.status != GetTransactionStatus.SUCCESS:
        raise RuntimeError(f"{op_name} did not succeed on-chain: {result.status}")
    return send.hash


def submit_update_group_score(
    *,
    contract_id: str,
    attestor: str,
    commitment: bytes,
    representative_wallet: str,
    risk_bucket: int,
    confidence: int,
    full_model_hash: bytes,
    distilled_model_hash: bytes,
    proof_or_hash: bytes,
    zk_verified: bool,
    kyc_verified: bool,
    issued_at: int,
    expires_at: int,
    attestor_seed: str,
    rpc_url: str = "https://soroban-testnet.stellar.org",
    network_passphrase: str = "Test SDF Network ; September 2015",
    timeout: int = 30,
) -> str:
    """Call ``WalletIdentity.update_group_score(attestor, commitment, attestation)``.

    Pushes the holistic group re-score (Phase 4.3) as the shared group
    ``AttestationData``. Attestor-authed (source-account credential), so no wallet
    co-sign is needed. ``representative_wallet`` fills ``AttestationData.wallet``
    (a member address — group resolution keys off ``commitment``, not this field);
    ``identity_commitment`` is set to ``commitment``. Returns the tx hash.

    Note: the contract rejects with ``AttestationNotFound`` if no wallet is
    registered on-chain under this commitment (``IdentityMemberCount == 0``).
    """
    if len(commitment) != 32:
        raise ValueError("commitment must be 32 bytes")
    params = AttestationParams(
        wallet=representative_wallet,
        risk_bucket=risk_bucket,
        confidence=confidence,
        full_model_hash=full_model_hash,
        distilled_model_hash=distilled_model_hash,
        proof_or_hash=proof_or_hash,
        zk_verified=zk_verified,
        attestor=attestor,
        issued_at=issued_at,
        expires_at=expires_at,
        kyc_verified=kyc_verified,
        identity_commitment=commitment,
    )
    keypair = Keypair.from_secret(attestor_seed)
    server = SorobanServer(rpc_url)
    source = server.load_account(keypair.public_key)
    tx = (
        TransactionBuilder(
            source_account=source,
            network_passphrase=network_passphrase,
            base_fee=100000,
        )
        .set_timeout(timeout)
        .append_invoke_contract_function_op(
            contract_id=contract_id,
            function_name="update_group_score",
            parameters=[
                StellarAddress(attestor).to_xdr_sc_val(),
                scval.to_bytes(commitment),
                _build_attestation_scval(params),
            ],
        )
        .build()
    )
    return _prepare_sign_send_poll(server, tx, keypair, timeout, "update_group_score")
