# Handoff (Ishita) — interactive co-sign for arbitrary-wallet attestation

Closes the gap you flagged: *"arbitrary-wallet live Soroban submission is not
solved, because the current contract/helper auth model requires both wallet auth
and attestor auth."*

We chose to **keep dual-auth** (no contract change) and do interactive co-signing:
the attestor server signs its own auth entry; the wallet (Freighter) signs the
envelope. This preserves per-attestation wallet consent.

**This is validated live on testnet** — a fresh wallet (≠ attestor) received a
`zk_verified=true` attestation this way:
[tx fda0a386…](https://stellar.expert/explorer/testnet/tx/fda0a386d3aac28bd02bcd9e06cc438b4b2eedfd2c5fc1035dacc603c78ebcc4)
(wallet `GDDAT4QZ…55O4F`, bucket 4, confidence 4251).

## The two seam functions (built, tested — yours to wire)

### 1. Server side — `zkredit_contracts.build_risc0_attestation_cosigned_xdr`

`contracts/bindings/python/zkredit_contracts/submit_attestation.py`

```python
from zkredit_contracts import AttestationParams, build_risc0_attestation_cosigned_xdr

partial_xdr = build_risc0_attestation_cosigned_xdr(
    contract_id=settings.contract_id_risk_attestation,
    wallet=stellar_address,          # the user's wallet = tx source
    params=AttestationParams(
        wallet=stellar_address,
        risk_bucket=99,              # placeholder; contract overwrites from journal
        confidence=0,                # placeholder
        full_model_hash=bytes(32),
        distilled_model_hash=bytes.fromhex(distilled_model_hash),
        proof_or_hash=bytes(32),
        zk_verified=False,
        attestor=settings.attestor_address,
        issued_at=..., expires_at=...,
        identity_commitment=None,    # or the 32-byte subject id
    ),
    seal=seal_bytes,                 # 256-byte Groth16 seal from the prover
    journal=journal_bytes,           # 72-byte guest journal from the prover
    attestor_seed=settings.attestor_seed,
    rpc_url=settings.soroban_rpc_url,
    network_passphrase=settings.soroban_network_passphrase,
)
# return partial_xdr to the browser (it is safe to expose — no attestor secret in it)
```

It builds the `attest_with_risc0` tx with the wallet as source, runs the
recording simulation, and signs **only** the attestor's Soroban auth entry. The
returned base-64 XDR is fully authorized except for the wallet's envelope
signature.

Suggested route shape: change `POST /api/v1/attest/{addr}` (or add
`/attest/{addr}/prepare`) so that in real-submission mode it returns
`{ "partial_xdr": ..., <scored fields> }` instead of a `tx_hash`. The
`contract_stub.submit_attestation` local-fallback path stays exactly as is for
dev/offline.

### 2. Client side — `submitCosignedAttestation`

`frontend/src/lib/contracts/rpc.ts` (exported from `lib/contracts`)

```ts
import { submitCosignedAttestation } from './lib/contracts'
import { connectFreighter } from './lib/freighter'

const wallet = await connectFreighter()
const { partial_xdr } = await fetch(`/api/v1/attest/${wallet}`, { method: 'POST' })
  .then(r => r.json())
const txHash = await submitCosignedAttestation(partial_xdr, wallet)
// then getAttestation(wallet) → zk_verified === true
```

Freighter signs the envelope (which satisfies the wallet's source-account
credential) and the helper submits + polls to SUCCESS. No per-entry signing on
the client — the wallet-as-source design avoids needing Freighter's
`signAuthEntry`.

## The one remaining ML-side piece (not auth-related)

`seal`/`journal` must be a **real proof for that wallet's features**. Today the
prover (`ml/risc0/host`) bakes a fixed demo feature vector, so any wallet gets
bucket 4. Wiring your feature-extraction + preprocessing output as the prover's
private input (the selected 30-dim transformed vector) is the last integration
step — the auth path above is agnostic to which seal/journal it carries.

## Note on the binding helpers

While wiring this I fixed a latent SDK-version bug in the same file:
`append_contract_call_op` → `append_invoke_contract_function_op` and
`to_xdr_scval()` → `to_xdr_sc_val()` (the names in stellar-sdk 14.1.1). That
means `submit_attestation_hash` / `submit_attestation_proof` are now actually
runnable against the installed SDK, not just importable.
