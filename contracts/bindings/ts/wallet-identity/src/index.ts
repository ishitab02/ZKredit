import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export const Errors = {
  1: {message:"AlreadyAttested"},
  2: {message:"NotAuthorized"},
  3: {message:"AttestationNotFound"},
  4: {message:"AttestationExpired"},
  5: {message:"InvalidProof"},
  6: {message:"AttestorNotRegistered"},
  7: {message:"AttestorRevoked"},
  8: {message:"ModelDeprecated"},
  9: {message:"InvalidInputs"},
  10: {message:"KycNotVerified"},
  /**
   * Wallet tried to join a group with a commitment different from one it already registered.
   */
  11: {message:"CommitmentConflict"},
  12: {message:"AlreadyInGroup"},
  /**
   * Caller is not an authorized attestor in the AttestorRegistry.
   */
  13: {message:"UnauthorizedAttestor"},
  /**
   * RISC Zero guest image id has not been registered (set_risc0_image_id).
   */
  14: {message:"Risc0ImageNotSet"},
  /**
   * Re-attestation carried an `issued_at` not strictly newer than the stored
   * one — rejected so an older (possibly better) score can't be replayed.
   */
  15: {message:"StaleAttestation"},
  /**
   * This KYC nullifier is already bound to a *different* identity commitment —
   * the same verified human cannot mint a second identity group (Sybil block).
   */
  16: {message:"NullifierAlreadyBound"}
}

export type DataKey = {tag: "Attestation", values: readonly [string]} | {tag: "Attestor", values: readonly [string]} | {tag: "Admin", values: void} | {tag: "VerificationKey", values: readonly [Buffer]} | {tag: "WalletCommitment", values: readonly [string]} | {tag: "IdentityAttestation", values: readonly [Buffer]} | {tag: "IdentityMemberCount", values: readonly [Buffer]} | {tag: "IdentityVerificationKey", values: void} | {tag: "Risc0ImageId", values: void} | {tag: "WalletIdentityContract", values: void} | {tag: "AttestorRegistry", values: void} | {tag: "RiskAttestation", values: void} | {tag: "NullifierCommitment", values: readonly [Buffer]} | {tag: "KycVerified", values: readonly [Buffer]};


/**
 * Common on-chain attestation record.
 * Per the ZKredit spec, only risk bucket, confidence, hashes, timestamps,
 * attestor, and wallet go on-chain. No raw wallet data.
 */
export interface AttestationData {
  attestor: string;
  confidence: u32;
  distilled_model_hash: Buffer;
  expires_at: u64;
  full_model_hash: Buffer;
  /**
 * Poseidon(secret) commitment that links this wallet to an identity group.
 * None means the wallet is not enrolled in any multi-wallet group.
 */
identity_commitment: Option<Buffer>;
  issued_at: u64;
  /**
 * Attestor-certified KYC status, bound via a Sybil-resistant nullifier
 * (WalletIdentity::bind_kyc). The credit *gate* in lending: only a
 * kyc_verified identity gets real borrowing capacity (anti-wallet-hopping);
 * un-KYC'd wallets get thin-file terms.
 */
kyc_verified: boolean;
  proof_or_hash: Buffer;
  risk_bucket: u32;
  wallet: string;
  zk_verified: boolean;
}


export interface Client {
  /**
   * Construct and simulate a bind_kyc transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Bind a KYC nullifier to an identity group — the Sybil-resistance gate.
   * 
   * `nullifier` is an opaque 32-byte value derived off-chain from the verified
   * document (HMAC of doc# + issuing country under a server pepper) — never raw
   * PII. Attestor-gated like `update_group_score`. The invariant: a nullifier
   * maps to exactly one commitment, so one verified human (one stable
   * nullifier) can only ever KYC a single identity group, no matter how many
   * fresh secrets they generate. Re-binding the *same* commitment is idempotent;
   * binding it to a *different* commitment is rejected (`NullifierAlreadyBound`).
   * On success the group is marked KYC-verified (`kyc_verified: true`), which the
   * lending pool reads as the credit gate.
   */
  bind_kyc: ({attestor, commitment, nullifier}: {attestor: string, commitment: Buffer, nullifier: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a leave_group transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove a wallet from its identity group.
   */
  leave_group: ({wallet}: {wallet: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a is_kyc_verified transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Whether an identity group has completed KYC (a nullifier is bound).
   */
  is_kyc_verified: ({commitment}: {commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a register_wallet transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Register a wallet as a member of the identity group identified by `commitment`.
   * 
   * If an identity VK has been registered (`set_identity_vk`), `proof_bytes`
   * must be a valid Groth16 proof whose public input equals `commitment` —
   * i.e. the caller proves knowledge of the secret without revealing it.
   * If no VK is set, registration is optimistic (proof ignored).
   */
  register_wallet: ({wallet, commitment, proof_bytes}: {wallet: string, commitment: Buffer, proof_bytes: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_identity_vk transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Register the Groth16 verification key for the Poseidon identity circuit.
   * Admin-only. Once set, `register_wallet` requires a valid proof that the
   * caller knows the secret behind the commitment being registered.
   */
  set_identity_vk: ({vk_bytes}: {vk_bytes: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a update_group_score transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update the aggregated group attestation for a commitment.
   * 
   * Attestor-gated (fixes the prior missing-auth bug): `attestor` must be a
   * registered attestor in the AttestorRegistry and must authorize the call,
   * so an arbitrary caller can no longer overwrite a group's shared score
   * (e.g. force VERY_LOW for free good terms, or grief a victim group).
   */
  update_group_score: ({attestor, commitment, attestation}: {attestor: string, commitment: Buffer, attestation: AttestationData}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_group_attestation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the aggregated attestation for an identity group, if any.
   * 
   * Overlays the group's KYC status: if the commitment has a bound nullifier
   * (`bind_kyc`), `kyc_verified` is forced true even when a later
   * `update_group_score` stored an attestation with it false — KYC, once
   * bound, is not silently dropped by a re-score.
   */
  get_group_attestation: ({commitment}: {commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<AttestationData>>>

  /**
   * Construct and simulate a set_attestor_registry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set the AttestorRegistry contract address. Admin-only. Once set,
   * `update_group_score` requires the caller to be a registered attestor.
   */
  set_attestor_registry: ({contract_id}: {contract_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin}: {admin: string},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAsdCaW5kIGEgS1lDIG51bGxpZmllciB0byBhbiBpZGVudGl0eSBncm91cCDigJQgdGhlIFN5YmlsLXJlc2lzdGFuY2UgZ2F0ZS4KCmBudWxsaWZpZXJgIGlzIGFuIG9wYXF1ZSAzMi1ieXRlIHZhbHVlIGRlcml2ZWQgb2ZmLWNoYWluIGZyb20gdGhlIHZlcmlmaWVkCmRvY3VtZW50IChITUFDIG9mIGRvYyMgKyBpc3N1aW5nIGNvdW50cnkgdW5kZXIgYSBzZXJ2ZXIgcGVwcGVyKSDigJQgbmV2ZXIgcmF3ClBJSS4gQXR0ZXN0b3ItZ2F0ZWQgbGlrZSBgdXBkYXRlX2dyb3VwX3Njb3JlYC4gVGhlIGludmFyaWFudDogYSBudWxsaWZpZXIKbWFwcyB0byBleGFjdGx5IG9uZSBjb21taXRtZW50LCBzbyBvbmUgdmVyaWZpZWQgaHVtYW4gKG9uZSBzdGFibGUKbnVsbGlmaWVyKSBjYW4gb25seSBldmVyIEtZQyBhIHNpbmdsZSBpZGVudGl0eSBncm91cCwgbm8gbWF0dGVyIGhvdyBtYW55CmZyZXNoIHNlY3JldHMgdGhleSBnZW5lcmF0ZS4gUmUtYmluZGluZyB0aGUgKnNhbWUqIGNvbW1pdG1lbnQgaXMgaWRlbXBvdGVudDsKYmluZGluZyBpdCB0byBhICpkaWZmZXJlbnQqIGNvbW1pdG1lbnQgaXMgcmVqZWN0ZWQgKGBOdWxsaWZpZXJBbHJlYWR5Qm91bmRgKS4KT24gc3VjY2VzcyB0aGUgZ3JvdXAgaXMgbWFya2VkIEtZQy12ZXJpZmllZCAoYGt5Y192ZXJpZmllZDogdHJ1ZWApLCB3aGljaCB0aGUKbGVuZGluZyBwb29sIHJlYWRzIGFzIHRoZSBjcmVkaXQgZ2F0ZS4AAAAACGJpbmRfa3ljAAAAAwAAAAAAAAAIYXR0ZXN0b3IAAAATAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAAAAAAAJbnVsbGlmaWVyAAAAAAAD7gAAACAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAChSZW1vdmUgYSB3YWxsZXQgZnJvbSBpdHMgaWRlbnRpdHkgZ3JvdXAuAAAAC2xlYXZlX2dyb3VwAAAAAAEAAAAAAAAABndhbGxldAAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAENXaGV0aGVyIGFuIGlkZW50aXR5IGdyb3VwIGhhcyBjb21wbGV0ZWQgS1lDIChhIG51bGxpZmllciBpcyBib3VuZCkuAAAAAA9pc19reWNfdmVyaWZpZWQAAAAAAQAAAAAAAAAKY29tbWl0bWVudAAAAAAD7gAAACAAAAABAAAAAQ==",
        "AAAAAAAAAWRSZWdpc3RlciBhIHdhbGxldCBhcyBhIG1lbWJlciBvZiB0aGUgaWRlbnRpdHkgZ3JvdXAgaWRlbnRpZmllZCBieSBgY29tbWl0bWVudGAuCgpJZiBhbiBpZGVudGl0eSBWSyBoYXMgYmVlbiByZWdpc3RlcmVkIChgc2V0X2lkZW50aXR5X3ZrYCksIGBwcm9vZl9ieXRlc2AKbXVzdCBiZSBhIHZhbGlkIEdyb3RoMTYgcHJvb2Ygd2hvc2UgcHVibGljIGlucHV0IGVxdWFscyBgY29tbWl0bWVudGAg4oCUCmkuZS4gdGhlIGNhbGxlciBwcm92ZXMga25vd2xlZGdlIG9mIHRoZSBzZWNyZXQgd2l0aG91dCByZXZlYWxpbmcgaXQuCklmIG5vIFZLIGlzIHNldCwgcmVnaXN0cmF0aW9uIGlzIG9wdGltaXN0aWMgKHByb29mIGlnbm9yZWQpLgAAAA9yZWdpc3Rlcl93YWxsZXQAAAAAAwAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAAAAAAALcHJvb2ZfYnl0ZXMAAAAADgAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAANBSZWdpc3RlciB0aGUgR3JvdGgxNiB2ZXJpZmljYXRpb24ga2V5IGZvciB0aGUgUG9zZWlkb24gaWRlbnRpdHkgY2lyY3VpdC4KQWRtaW4tb25seS4gT25jZSBzZXQsIGByZWdpc3Rlcl93YWxsZXRgIHJlcXVpcmVzIGEgdmFsaWQgcHJvb2YgdGhhdCB0aGUKY2FsbGVyIGtub3dzIHRoZSBzZWNyZXQgYmVoaW5kIHRoZSBjb21taXRtZW50IGJlaW5nIHJlZ2lzdGVyZWQuAAAAD3NldF9pZGVudGl0eV92awAAAAABAAAAAAAAAAh2a19ieXRlcwAAAA4AAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAVVVcGRhdGUgdGhlIGFnZ3JlZ2F0ZWQgZ3JvdXAgYXR0ZXN0YXRpb24gZm9yIGEgY29tbWl0bWVudC4KCkF0dGVzdG9yLWdhdGVkIChmaXhlcyB0aGUgcHJpb3IgbWlzc2luZy1hdXRoIGJ1Zyk6IGBhdHRlc3RvcmAgbXVzdCBiZSBhCnJlZ2lzdGVyZWQgYXR0ZXN0b3IgaW4gdGhlIEF0dGVzdG9yUmVnaXN0cnkgYW5kIG11c3QgYXV0aG9yaXplIHRoZSBjYWxsLApzbyBhbiBhcmJpdHJhcnkgY2FsbGVyIGNhbiBubyBsb25nZXIgb3ZlcndyaXRlIGEgZ3JvdXAncyBzaGFyZWQgc2NvcmUKKGUuZy4gZm9yY2UgVkVSWV9MT1cgZm9yIGZyZWUgZ29vZCB0ZXJtcywgb3IgZ3JpZWYgYSB2aWN0aW0gZ3JvdXApLgAAAAAAABJ1cGRhdGVfZ3JvdXBfc2NvcmUAAAAAAAMAAAAAAAAACGF0dGVzdG9yAAAAEwAAAAAAAAAKY29tbWl0bWVudAAAAAAD7gAAACAAAAAAAAAAC2F0dGVzdGF0aW9uAAAAB9AAAAAPQXR0ZXN0YXRpb25EYXRhAAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAT1SZXR1cm4gdGhlIGFnZ3JlZ2F0ZWQgYXR0ZXN0YXRpb24gZm9yIGFuIGlkZW50aXR5IGdyb3VwLCBpZiBhbnkuCgpPdmVybGF5cyB0aGUgZ3JvdXAncyBLWUMgc3RhdHVzOiBpZiB0aGUgY29tbWl0bWVudCBoYXMgYSBib3VuZCBudWxsaWZpZXIKKGBiaW5kX2t5Y2ApLCBga3ljX3ZlcmlmaWVkYCBpcyBmb3JjZWQgdHJ1ZSBldmVuIHdoZW4gYSBsYXRlcgpgdXBkYXRlX2dyb3VwX3Njb3JlYCBzdG9yZWQgYW4gYXR0ZXN0YXRpb24gd2l0aCBpdCBmYWxzZSDigJQgS1lDLCBvbmNlCmJvdW5kLCBpcyBub3Qgc2lsZW50bHkgZHJvcHBlZCBieSBhIHJlLXNjb3JlLgAAAAAAABVnZXRfZ3JvdXBfYXR0ZXN0YXRpb24AAAAAAAABAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAAEAAAPoAAAH0AAAAA9BdHRlc3RhdGlvbkRhdGEA",
        "AAAAAAAAAIZTZXQgdGhlIEF0dGVzdG9yUmVnaXN0cnkgY29udHJhY3QgYWRkcmVzcy4gQWRtaW4tb25seS4gT25jZSBzZXQsCmB1cGRhdGVfZ3JvdXBfc2NvcmVgIHJlcXVpcmVzIHRoZSBjYWxsZXIgdG8gYmUgYSByZWdpc3RlcmVkIGF0dGVzdG9yLgAAAAAAFXNldF9hdHRlc3Rvcl9yZWdpc3RyeQAAAAAAAAEAAAAAAAAAC2NvbnRyYWN0X2lkAAAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAEAAAAAAAAAAPQWxyZWFkeUF0dGVzdGVkAAAAAAEAAAAAAAAADU5vdEF1dGhvcml6ZWQAAAAAAAACAAAAAAAAABNBdHRlc3RhdGlvbk5vdEZvdW5kAAAAAAMAAAAAAAAAEkF0dGVzdGF0aW9uRXhwaXJlZAAAAAAABAAAAAAAAAAMSW52YWxpZFByb29mAAAABQAAAAAAAAAVQXR0ZXN0b3JOb3RSZWdpc3RlcmVkAAAAAAAABgAAAAAAAAAPQXR0ZXN0b3JSZXZva2VkAAAAAAcAAAAAAAAAD01vZGVsRGVwcmVjYXRlZAAAAAAIAAAAAAAAAA1JbnZhbGlkSW5wdXRzAAAAAAAACQAAAAAAAAAOS3ljTm90VmVyaWZpZWQAAAAAAAoAAABYV2FsbGV0IHRyaWVkIHRvIGpvaW4gYSBncm91cCB3aXRoIGEgY29tbWl0bWVudCBkaWZmZXJlbnQgZnJvbSBvbmUgaXQgYWxyZWFkeSByZWdpc3RlcmVkLgAAABJDb21taXRtZW50Q29uZmxpY3QAAAAAAAsAAAAAAAAADkFscmVhZHlJbkdyb3VwAAAAAAAMAAAAPUNhbGxlciBpcyBub3QgYW4gYXV0aG9yaXplZCBhdHRlc3RvciBpbiB0aGUgQXR0ZXN0b3JSZWdpc3RyeS4AAAAAAAAUVW5hdXRob3JpemVkQXR0ZXN0b3IAAAANAAAARlJJU0MgWmVybyBndWVzdCBpbWFnZSBpZCBoYXMgbm90IGJlZW4gcmVnaXN0ZXJlZCAoc2V0X3Jpc2MwX2ltYWdlX2lkKS4AAAAAABBSaXNjMEltYWdlTm90U2V0AAAADgAAAJBSZS1hdHRlc3RhdGlvbiBjYXJyaWVkIGFuIGBpc3N1ZWRfYXRgIG5vdCBzdHJpY3RseSBuZXdlciB0aGFuIHRoZSBzdG9yZWQKb25lIOKAlCByZWplY3RlZCBzbyBhbiBvbGRlciAocG9zc2libHkgYmV0dGVyKSBzY29yZSBjYW4ndCBiZSByZXBsYXllZC4AAAAQU3RhbGVBdHRlc3RhdGlvbgAAAA8AAACXVGhpcyBLWUMgbnVsbGlmaWVyIGlzIGFscmVhZHkgYm91bmQgdG8gYSAqZGlmZmVyZW50KiBpZGVudGl0eSBjb21taXRtZW50IOKAlAp0aGUgc2FtZSB2ZXJpZmllZCBodW1hbiBjYW5ub3QgbWludCBhIHNlY29uZCBpZGVudGl0eSBncm91cCAoU3liaWwgYmxvY2spLgAAAAAVTnVsbGlmaWVyQWxyZWFkeUJvdW5kAAAAAAAAEA==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAADgAAAAEAAAAAAAAAC0F0dGVzdGF0aW9uAAAAAAEAAAATAAAAAQAAAAAAAAAIQXR0ZXN0b3IAAAABAAAAEwAAAAAAAAAAAAAABUFkbWluAAAAAAAAAQAAAIFHcm90aDE2IHZlcmlmaWNhdGlvbiBrZXksIGtleWVkIGJ5IGRpc3RpbGxlZF9tb2RlbF9oYXNoLgpSZWdpc3RlcmVkIGJ5IGFkbWluOyBlbmFibGVzIG9uLWNoYWluIHByb29mIHZlcmlmaWNhdGlvbiBmb3IgdGhhdCBtb2RlbC4AAAAAAAAPVmVyaWZpY2F0aW9uS2V5AAAAAAEAAAPuAAAAIAAAAAEAAABTTWFwcyBhIHdhbGxldCBhZGRyZXNzIHRvIGl0cyBQb3NlaWRvbiBpZGVudGl0eSBjb21taXRtZW50IChtdWx0aS13YWxsZXQgZ3JvdXAga2V5KS4AAAAAEFdhbGxldENvbW1pdG1lbnQAAAABAAAAEwAAAAEAAABKQWdncmVnYXRlZCBncm91cCBBdHRlc3RhdGlvbkRhdGEsIGtleWVkIGJ5IHRoZSBzaGFyZWQgUG9zZWlkb24gY29tbWl0bWVudC4AAAAAABNJZGVudGl0eUF0dGVzdGF0aW9uAAAAAAEAAAPuAAAAIAAAAAEAAABEQ291bnQgb2Ygd2FsbGV0cyBlbnJvbGxlZCBpbiBhbiBpZGVudGl0eSBncm91cCAoY29tbWl0bWVudCDihpIgdTMyKS4AAAATSWRlbnRpdHlNZW1iZXJDb3VudAAAAAABAAAD7gAAACAAAAAAAAAAj0dyb3RoMTYgVksgZm9yIHRoZSBQb3NlaWRvbiBpZGVudGl0eSBjaXJjdWl0LCBzdG9yZWQgYnkgV2FsbGV0SWRlbnRpdHkuCldoZW4gc2V0LCBgcmVnaXN0ZXJfd2FsbGV0YCByZXF1aXJlcyBhIHZhbGlkIHByb29mIG9mIHNlY3JldCBrbm93bGVkZ2UuAAAAABdJZGVudGl0eVZlcmlmaWNhdGlvbktleQAAAAAAAAAAmVdoaXRlbGlzdGVkIFJJU0MgWmVybyBndWVzdCBpbWFnZSBpZCAodGhlIGRpc3RpbGxlZC1tb2RlbCBndWVzdCksIHN0b3JlZCBieQpSaXNrQXR0ZXN0YXRpb24uIE9ubHkgcmVjZWlwdHMgZnJvbSB0aGlzIGltYWdlIHZlcmlmeSBpbiBgYXR0ZXN0X3dpdGhfcmlzYzBgLgAAAAAAAAxSaXNjMEltYWdlSWQAAAAAAAAAWVdhbGxldElkZW50aXR5IGNvbnRyYWN0IGFkZHJlc3MsIHN0b3JlZCBieSBSaXNrQXR0ZXN0YXRpb24gZm9yIGNyb3NzLWNvbnRyYWN0IHJlc29sdXRpb24uAAAAAAAAFldhbGxldElkZW50aXR5Q29udHJhY3QAAAAAAAAAAABNQWRkcmVzcyBvZiB0aGUgQXR0ZXN0b3JSZWdpc3RyeSBjb250cmFjdCB1c2VkIHRvIHZhbGlkYXRlIGF0dGVzdG9yIGFkZHJlc3Nlcy4AAAAAAAAQQXR0ZXN0b3JSZWdpc3RyeQAAAAAAAABcQWRkcmVzcyBvZiB0aGUgUmlza0F0dGVzdGF0aW9uIGNvbnRyYWN0IHVzZWQgYnkgZG93bnN0cmVhbSBjb25zdW1lcnMgKGUuZy4gTW9ja0xlbmRpbmdQb29sKS4AAAAPUmlza0F0dGVzdGF0aW9uAAAAAAEAAAEYU3liaWwtcmVzaXN0YW5jZSByZWdpc3RyeTogbWFwcyBhbiBvcGFxdWUgS1lDIG51bGxpZmllciAoSE1BQyBvZiB0aGUKdmVyaWZpZWQgZG9jdW1lbnQsIGNvbXB1dGVkIG9mZi1jaGFpbiDigJQgbmV2ZXIgcmF3IFBJSSkgdG8gdGhlIHNpbmdsZQppZGVudGl0eSBjb21taXRtZW50IGl0IGlzIGJvdW5kIHRvLiBPbmUgdmVyaWZpZWQgaHVtYW4g4oaSIG9uZSBudWxsaWZpZXIg4oaSCmF0IG1vc3Qgb25lIGlkZW50aXR5IGdyb3VwLiBTdG9yZWQgYnkgV2FsbGV0SWRlbnRpdHk6OmJpbmRfa3ljLgAAABNOdWxsaWZpZXJDb21taXRtZW50AAAAAAEAAAPuAAAAIAAAAAEAAADSV2hldGhlciBhbiBpZGVudGl0eSBncm91cCAoY29tbWl0bWVudCkgaGFzIGEgYm91bmQgS1lDIG51bGxpZmllciwgaS5lLiBpcwpLWUMtdmVyaWZpZWQuIFNldCBieSBiaW5kX2t5Yzsgb3ZlcmxhaWQgb250byB0aGUgZ3JvdXAgQXR0ZXN0YXRpb25EYXRhIHNvCktZQyBzdXJ2aXZlcyByZWdhcmRsZXNzIG9mIHNjb3Jpbmcgb3JkZXIuIGNvbW1pdG1lbnQg4oaSIGJvb2wuAAAAAAALS3ljVmVyaWZpZWQAAAAAAQAAA+4AAAAg",
        "AAAAAQAAAKFDb21tb24gb24tY2hhaW4gYXR0ZXN0YXRpb24gcmVjb3JkLgpQZXIgdGhlIFpLcmVkaXQgc3BlYywgb25seSByaXNrIGJ1Y2tldCwgY29uZmlkZW5jZSwgaGFzaGVzLCB0aW1lc3RhbXBzLAphdHRlc3RvciwgYW5kIHdhbGxldCBnbyBvbi1jaGFpbi4gTm8gcmF3IHdhbGxldCBkYXRhLgAAAAAAAAAAAAAPQXR0ZXN0YXRpb25EYXRhAAAAAAwAAAAAAAAACGF0dGVzdG9yAAAAEwAAAAAAAAAKY29uZmlkZW5jZQAAAAAABAAAAAAAAAAUZGlzdGlsbGVkX21vZGVsX2hhc2gAAAPuAAAAIAAAAAAAAAAKZXhwaXJlc19hdAAAAAAABgAAAAAAAAAPZnVsbF9tb2RlbF9oYXNoAAAAA+4AAAAgAAAAiVBvc2VpZG9uKHNlY3JldCkgY29tbWl0bWVudCB0aGF0IGxpbmtzIHRoaXMgd2FsbGV0IHRvIGFuIGlkZW50aXR5IGdyb3VwLgpOb25lIG1lYW5zIHRoZSB3YWxsZXQgaXMgbm90IGVucm9sbGVkIGluIGFueSBtdWx0aS13YWxsZXQgZ3JvdXAuAAAAAAAAE2lkZW50aXR5X2NvbW1pdG1lbnQAAAAD6AAAA+4AAAAgAAAAAAAAAAlpc3N1ZWRfYXQAAAAAAAAGAAAA9UF0dGVzdG9yLWNlcnRpZmllZCBLWUMgc3RhdHVzLCBib3VuZCB2aWEgYSBTeWJpbC1yZXNpc3RhbnQgbnVsbGlmaWVyCihXYWxsZXRJZGVudGl0eTo6YmluZF9reWMpLiBUaGUgY3JlZGl0ICpnYXRlKiBpbiBsZW5kaW5nOiBvbmx5IGEKa3ljX3ZlcmlmaWVkIGlkZW50aXR5IGdldHMgcmVhbCBib3Jyb3dpbmcgY2FwYWNpdHkgKGFudGktd2FsbGV0LWhvcHBpbmcpOwp1bi1LWUMnZCB3YWxsZXRzIGdldCB0aGluLWZpbGUgdGVybXMuAAAAAAAADGt5Y192ZXJpZmllZAAAAAEAAAAAAAAADXByb29mX29yX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAALcmlza19idWNrZXQAAAAABAAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAAAAAAt6a192ZXJpZmllZAAAAAAB",
        "AAAABQAAACNTdGFuZGFyZCBhdHRlc3RhdGlvbi13cml0dGVuIGV2ZW50LgAAAAAAAAAAEkF0dGVzdGF0aW9uV3JpdHRlbgAAAAAAAQAAAAZhdHRlc3QAAAAAAAQAAAAAAAAABndhbGxldAAAAAAAEwAAAAEAAAAAAAAACGF0dGVzdG9yAAAAEwAAAAEAAAAAAAAAC3Jpc2tfYnVja2V0AAAAAAQAAAABAAAAAAAAAARkYXRhAAAH0AAAAA9BdHRlc3RhdGlvbkRhdGEAAAAAAAAAAAI=" ]),
      options
    )
  }
  public readonly fromJSON = {
    bind_kyc: this.txFromJSON<Result<void>>,
        leave_group: this.txFromJSON<Result<void>>,
        is_kyc_verified: this.txFromJSON<boolean>,
        register_wallet: this.txFromJSON<Result<void>>,
        set_identity_vk: this.txFromJSON<Result<void>>,
        update_group_score: this.txFromJSON<Result<void>>,
        get_group_attestation: this.txFromJSON<Option<AttestationData>>,
        set_attestor_registry: this.txFromJSON<Result<void>>
  }
}