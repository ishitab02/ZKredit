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
  13: {message:"UnauthorizedAttestor"}
}

export type DataKey = {tag: "Attestation", values: readonly [string]} | {tag: "Attestor", values: readonly [string]} | {tag: "Admin", values: void} | {tag: "VerificationKey", values: readonly [Buffer]} | {tag: "WalletCommitment", values: readonly [string]} | {tag: "IdentityAttestation", values: readonly [Buffer]} | {tag: "IdentityMemberCount", values: readonly [Buffer]} | {tag: "IdentityVerificationKey", values: void} | {tag: "WalletIdentityContract", values: void} | {tag: "AttestorRegistry", values: void} | {tag: "RiskAttestation", values: void};


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
 * Attestor-certified KYC status. Unlocks −100 bps APR discount in lending contracts.
 */
kyc_verified: boolean;
  proof_or_hash: Buffer;
  risk_bucket: u32;
  wallet: string;
  zk_verified: boolean;
}


export interface Client {
  /**
   * Construct and simulate a get_attestation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read a wallet's attestation.
   * 
   * Multi-wallet resolution (Option A — shared group score): if the wallet's
   * own attestation carries an `identity_commitment` and a WalletIdentity
   * contract is configured, the shared group attestation is returned instead,
   * so any wallet in the group surfaces the group's best score. The querying
   * wallet's own record is never exposed when a group score is available.
   */
  get_attestation: ({wallet}: {wallet: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<AttestationData>>>

  /**
   * Construct and simulate a attest_with_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Optimistic hash-anchored attestation path.  Stores the attestation
   * without on-chain proof verification.  `zk_verified` is always false.
   */
  attest_with_hash: ({wallet, data}: {wallet: string, data: AttestationData}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a attest_with_proof transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Full Groth16 on-chain verification path.
   * 
   * If a verification key for `data.distilled_model_hash` has been registered
   * via `register_verification_key`, the proof is verified on-chain and
   * `zk_verified` is set to `true`.  Otherwise falls back to the hash-anchored
   * path with `zk_verified = false` (DG1 fallback behaviour).
   */
  attest_with_proof: ({wallet, data, proof_bytes}: {wallet: string, data: AttestationData, proof_bytes: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_wallet_identity transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set the WalletIdentity contract address. Admin-only. Optional: when set,
   * `get_attestation` resolves a wallet's `identity_commitment` to the shared
   * group attestation (multi-wallet reputation sharing).
   */
  set_wallet_identity: ({contract_id}: {contract_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_attestor_registry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set the AttestorRegistry contract address. Admin-only.
   */
  set_attestor_registry: ({contract_id}: {contract_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a register_verification_key transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Register a Groth16 verification key for a distilled model.
   * Admin-only.  Must be called before `attest_with_proof` can set
   * `zk_verified = true` for attestations using that model.
   */
  register_verification_key: ({model_hash, vk_bytes}: {model_hash: Buffer, vk_bytes: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
      new ContractSpec([ "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAYdSZWFkIGEgd2FsbGV0J3MgYXR0ZXN0YXRpb24uCgpNdWx0aS13YWxsZXQgcmVzb2x1dGlvbiAoT3B0aW9uIEEg4oCUIHNoYXJlZCBncm91cCBzY29yZSk6IGlmIHRoZSB3YWxsZXQncwpvd24gYXR0ZXN0YXRpb24gY2FycmllcyBhbiBgaWRlbnRpdHlfY29tbWl0bWVudGAgYW5kIGEgV2FsbGV0SWRlbnRpdHkKY29udHJhY3QgaXMgY29uZmlndXJlZCwgdGhlIHNoYXJlZCBncm91cCBhdHRlc3RhdGlvbiBpcyByZXR1cm5lZCBpbnN0ZWFkLApzbyBhbnkgd2FsbGV0IGluIHRoZSBncm91cCBzdXJmYWNlcyB0aGUgZ3JvdXAncyBiZXN0IHNjb3JlLiBUaGUgcXVlcnlpbmcKd2FsbGV0J3Mgb3duIHJlY29yZCBpcyBuZXZlciBleHBvc2VkIHdoZW4gYSBncm91cCBzY29yZSBpcyBhdmFpbGFibGUuAAAAAA9nZXRfYXR0ZXN0YXRpb24AAAAAAQAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAQAAA+gAAAfQAAAAD0F0dGVzdGF0aW9uRGF0YQA=",
        "AAAAAAAAAIdPcHRpbWlzdGljIGhhc2gtYW5jaG9yZWQgYXR0ZXN0YXRpb24gcGF0aC4gIFN0b3JlcyB0aGUgYXR0ZXN0YXRpb24Kd2l0aG91dCBvbi1jaGFpbiBwcm9vZiB2ZXJpZmljYXRpb24uICBgemtfdmVyaWZpZWRgIGlzIGFsd2F5cyBmYWxzZS4AAAAAEGF0dGVzdF93aXRoX2hhc2gAAAACAAAAAAAAAAZ3YWxsZXQAAAAAABMAAAAAAAAABGRhdGEAAAfQAAAAD0F0dGVzdGF0aW9uRGF0YQAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAATxGdWxsIEdyb3RoMTYgb24tY2hhaW4gdmVyaWZpY2F0aW9uIHBhdGguCgpJZiBhIHZlcmlmaWNhdGlvbiBrZXkgZm9yIGBkYXRhLmRpc3RpbGxlZF9tb2RlbF9oYXNoYCBoYXMgYmVlbiByZWdpc3RlcmVkCnZpYSBgcmVnaXN0ZXJfdmVyaWZpY2F0aW9uX2tleWAsIHRoZSBwcm9vZiBpcyB2ZXJpZmllZCBvbi1jaGFpbiBhbmQKYHprX3ZlcmlmaWVkYCBpcyBzZXQgdG8gYHRydWVgLiAgT3RoZXJ3aXNlIGZhbGxzIGJhY2sgdG8gdGhlIGhhc2gtYW5jaG9yZWQKcGF0aCB3aXRoIGB6a192ZXJpZmllZCA9IGZhbHNlYCAoREcxIGZhbGxiYWNrIGJlaGF2aW91cikuAAAAEWF0dGVzdF93aXRoX3Byb29mAAAAAAAAAwAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAAAAAARkYXRhAAAH0AAAAA9BdHRlc3RhdGlvbkRhdGEAAAAAAAAAAAtwcm9vZl9ieXRlcwAAAAAOAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAMdTZXQgdGhlIFdhbGxldElkZW50aXR5IGNvbnRyYWN0IGFkZHJlc3MuIEFkbWluLW9ubHkuIE9wdGlvbmFsOiB3aGVuIHNldCwKYGdldF9hdHRlc3RhdGlvbmAgcmVzb2x2ZXMgYSB3YWxsZXQncyBgaWRlbnRpdHlfY29tbWl0bWVudGAgdG8gdGhlIHNoYXJlZApncm91cCBhdHRlc3RhdGlvbiAobXVsdGktd2FsbGV0IHJlcHV0YXRpb24gc2hhcmluZykuAAAAABNzZXRfd2FsbGV0X2lkZW50aXR5AAAAAAEAAAAAAAAAC2NvbnRyYWN0X2lkAAAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAADZTZXQgdGhlIEF0dGVzdG9yUmVnaXN0cnkgY29udHJhY3QgYWRkcmVzcy4gQWRtaW4tb25seS4AAAAAABVzZXRfYXR0ZXN0b3JfcmVnaXN0cnkAAAAAAAABAAAAAAAAAAtjb250cmFjdF9pZAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAALFSZWdpc3RlciBhIEdyb3RoMTYgdmVyaWZpY2F0aW9uIGtleSBmb3IgYSBkaXN0aWxsZWQgbW9kZWwuCkFkbWluLW9ubHkuICBNdXN0IGJlIGNhbGxlZCBiZWZvcmUgYGF0dGVzdF93aXRoX3Byb29mYCBjYW4gc2V0CmB6a192ZXJpZmllZCA9IHRydWVgIGZvciBhdHRlc3RhdGlvbnMgdXNpbmcgdGhhdCBtb2RlbC4AAAAAAAAZcmVnaXN0ZXJfdmVyaWZpY2F0aW9uX2tleQAAAAAAAAIAAAAAAAAACm1vZGVsX2hhc2gAAAAAA+4AAAAgAAAAAAAAAAh2a19ieXRlcwAAAA4AAAABAAAD6QAAAAIAAAAD",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAADQAAAAAAAAAPQWxyZWFkeUF0dGVzdGVkAAAAAAEAAAAAAAAADU5vdEF1dGhvcml6ZWQAAAAAAAACAAAAAAAAABNBdHRlc3RhdGlvbk5vdEZvdW5kAAAAAAMAAAAAAAAAEkF0dGVzdGF0aW9uRXhwaXJlZAAAAAAABAAAAAAAAAAMSW52YWxpZFByb29mAAAABQAAAAAAAAAVQXR0ZXN0b3JOb3RSZWdpc3RlcmVkAAAAAAAABgAAAAAAAAAPQXR0ZXN0b3JSZXZva2VkAAAAAAcAAAAAAAAAD01vZGVsRGVwcmVjYXRlZAAAAAAIAAAAAAAAAA1JbnZhbGlkSW5wdXRzAAAAAAAACQAAAAAAAAAOS3ljTm90VmVyaWZpZWQAAAAAAAoAAABYV2FsbGV0IHRyaWVkIHRvIGpvaW4gYSBncm91cCB3aXRoIGEgY29tbWl0bWVudCBkaWZmZXJlbnQgZnJvbSBvbmUgaXQgYWxyZWFkeSByZWdpc3RlcmVkLgAAABJDb21taXRtZW50Q29uZmxpY3QAAAAAAAsAAAAAAAAADkFscmVhZHlJbkdyb3VwAAAAAAAMAAAAPUNhbGxlciBpcyBub3QgYW4gYXV0aG9yaXplZCBhdHRlc3RvciBpbiB0aGUgQXR0ZXN0b3JSZWdpc3RyeS4AAAAAAAAUVW5hdXRob3JpemVkQXR0ZXN0b3IAAAAN",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAACwAAAAEAAAAAAAAAC0F0dGVzdGF0aW9uAAAAAAEAAAATAAAAAQAAAAAAAAAIQXR0ZXN0b3IAAAABAAAAEwAAAAAAAAAAAAAABUFkbWluAAAAAAAAAQAAAIFHcm90aDE2IHZlcmlmaWNhdGlvbiBrZXksIGtleWVkIGJ5IGRpc3RpbGxlZF9tb2RlbF9oYXNoLgpSZWdpc3RlcmVkIGJ5IGFkbWluOyBlbmFibGVzIG9uLWNoYWluIHByb29mIHZlcmlmaWNhdGlvbiBmb3IgdGhhdCBtb2RlbC4AAAAAAAAPVmVyaWZpY2F0aW9uS2V5AAAAAAEAAAPuAAAAIAAAAAEAAABTTWFwcyBhIHdhbGxldCBhZGRyZXNzIHRvIGl0cyBQb3NlaWRvbiBpZGVudGl0eSBjb21taXRtZW50IChtdWx0aS13YWxsZXQgZ3JvdXAga2V5KS4AAAAAEFdhbGxldENvbW1pdG1lbnQAAAABAAAAEwAAAAEAAABKQWdncmVnYXRlZCBncm91cCBBdHRlc3RhdGlvbkRhdGEsIGtleWVkIGJ5IHRoZSBzaGFyZWQgUG9zZWlkb24gY29tbWl0bWVudC4AAAAAABNJZGVudGl0eUF0dGVzdGF0aW9uAAAAAAEAAAPuAAAAIAAAAAEAAABEQ291bnQgb2Ygd2FsbGV0cyBlbnJvbGxlZCBpbiBhbiBpZGVudGl0eSBncm91cCAoY29tbWl0bWVudCDihpIgdTMyKS4AAAATSWRlbnRpdHlNZW1iZXJDb3VudAAAAAABAAAD7gAAACAAAAAAAAAAj0dyb3RoMTYgVksgZm9yIHRoZSBQb3NlaWRvbiBpZGVudGl0eSBjaXJjdWl0LCBzdG9yZWQgYnkgV2FsbGV0SWRlbnRpdHkuCldoZW4gc2V0LCBgcmVnaXN0ZXJfd2FsbGV0YCByZXF1aXJlcyBhIHZhbGlkIHByb29mIG9mIHNlY3JldCBrbm93bGVkZ2UuAAAAABdJZGVudGl0eVZlcmlmaWNhdGlvbktleQAAAAAAAAAAWVdhbGxldElkZW50aXR5IGNvbnRyYWN0IGFkZHJlc3MsIHN0b3JlZCBieSBSaXNrQXR0ZXN0YXRpb24gZm9yIGNyb3NzLWNvbnRyYWN0IHJlc29sdXRpb24uAAAAAAAAFldhbGxldElkZW50aXR5Q29udHJhY3QAAAAAAAAAAABNQWRkcmVzcyBvZiB0aGUgQXR0ZXN0b3JSZWdpc3RyeSBjb250cmFjdCB1c2VkIHRvIHZhbGlkYXRlIGF0dGVzdG9yIGFkZHJlc3Nlcy4AAAAAAAAQQXR0ZXN0b3JSZWdpc3RyeQAAAAAAAABcQWRkcmVzcyBvZiB0aGUgUmlza0F0dGVzdGF0aW9uIGNvbnRyYWN0IHVzZWQgYnkgZG93bnN0cmVhbSBjb25zdW1lcnMgKGUuZy4gTW9ja0xlbmRpbmdQb29sKS4AAAAPUmlza0F0dGVzdGF0aW9uAA==",
        "AAAAAQAAAKFDb21tb24gb24tY2hhaW4gYXR0ZXN0YXRpb24gcmVjb3JkLgpQZXIgdGhlIFpLcmVkaXQgc3BlYywgb25seSByaXNrIGJ1Y2tldCwgY29uZmlkZW5jZSwgaGFzaGVzLCB0aW1lc3RhbXBzLAphdHRlc3RvciwgYW5kIHdhbGxldCBnbyBvbi1jaGFpbi4gTm8gcmF3IHdhbGxldCBkYXRhLgAAAAAAAAAAAAAPQXR0ZXN0YXRpb25EYXRhAAAAAAwAAAAAAAAACGF0dGVzdG9yAAAAEwAAAAAAAAAKY29uZmlkZW5jZQAAAAAABAAAAAAAAAAUZGlzdGlsbGVkX21vZGVsX2hhc2gAAAPuAAAAIAAAAAAAAAAKZXhwaXJlc19hdAAAAAAABgAAAAAAAAAPZnVsbF9tb2RlbF9oYXNoAAAAA+4AAAAgAAAAiVBvc2VpZG9uKHNlY3JldCkgY29tbWl0bWVudCB0aGF0IGxpbmtzIHRoaXMgd2FsbGV0IHRvIGFuIGlkZW50aXR5IGdyb3VwLgpOb25lIG1lYW5zIHRoZSB3YWxsZXQgaXMgbm90IGVucm9sbGVkIGluIGFueSBtdWx0aS13YWxsZXQgZ3JvdXAuAAAAAAAAE2lkZW50aXR5X2NvbW1pdG1lbnQAAAAD6AAAA+4AAAAgAAAAAAAAAAlpc3N1ZWRfYXQAAAAAAAAGAAAAVEF0dGVzdG9yLWNlcnRpZmllZCBLWUMgc3RhdHVzLiBVbmxvY2tzIOKIkjEwMCBicHMgQVBSIGRpc2NvdW50IGluIGxlbmRpbmcgY29udHJhY3RzLgAAAAxreWNfdmVyaWZpZWQAAAABAAAAAAAAAA1wcm9vZl9vcl9oYXNoAAAAAAAD7gAAACAAAAAAAAAAC3Jpc2tfYnVja2V0AAAAAAQAAAAAAAAABndhbGxldAAAAAAAEwAAAAAAAAALemtfdmVyaWZpZWQAAAAAAQ==",
        "AAAABQAAACNTdGFuZGFyZCBhdHRlc3RhdGlvbi13cml0dGVuIGV2ZW50LgAAAAAAAAAAEkF0dGVzdGF0aW9uV3JpdHRlbgAAAAAAAQAAAAZhdHRlc3QAAAAAAAQAAAAAAAAABndhbGxldAAAAAAAEwAAAAEAAAAAAAAACGF0dGVzdG9yAAAAEwAAAAEAAAAAAAAAC3Jpc2tfYnVja2V0AAAAAAQAAAABAAAAAAAAAARkYXRhAAAH0AAAAA9BdHRlc3RhdGlvbkRhdGEAAAAAAAAAAAI=" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_attestation: this.txFromJSON<Option<AttestationData>>,
        attest_with_hash: this.txFromJSON<Result<void>>,
        attest_with_proof: this.txFromJSON<Result<void>>,
        set_wallet_identity: this.txFromJSON<Result<void>>,
        set_attestor_registry: this.txFromJSON<Result<void>>,
        register_verification_key: this.txFromJSON<Result<void>>
  }
}