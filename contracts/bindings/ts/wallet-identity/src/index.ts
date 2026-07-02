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
  14: {message:"Risc0ImageNotSet"}
}

export type DataKey = {tag: "Attestation", values: readonly [string]} | {tag: "Attestor", values: readonly [string]} | {tag: "Admin", values: void} | {tag: "VerificationKey", values: readonly [Buffer]} | {tag: "WalletCommitment", values: readonly [string]} | {tag: "IdentityAttestation", values: readonly [Buffer]} | {tag: "IdentityMemberCount", values: readonly [Buffer]} | {tag: "IdentityVerificationKey", values: void} | {tag: "Risc0ImageId", values: void} | {tag: "WalletIdentityContract", values: void} | {tag: "AttestorRegistry", values: void} | {tag: "RiskAttestation", values: void};


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
   * Construct and simulate a leave_group transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove a wallet from its identity group.
   */
  leave_group: ({wallet}: {wallet: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
   * In v1 this is a stub used by the RiskAttestation flow.
   */
  update_group_score: ({commitment, attestation}: {commitment: Buffer, attestation: AttestationData}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_group_attestation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the aggregated attestation for an identity group, if any.
   */
  get_group_attestation: ({commitment}: {commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<AttestationData>>>

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
      new ContractSpec([ "AAAAAAAAAChSZW1vdmUgYSB3YWxsZXQgZnJvbSBpdHMgaWRlbnRpdHkgZ3JvdXAuAAAAC2xlYXZlX2dyb3VwAAAAAAEAAAAAAAAABndhbGxldAAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAWRSZWdpc3RlciBhIHdhbGxldCBhcyBhIG1lbWJlciBvZiB0aGUgaWRlbnRpdHkgZ3JvdXAgaWRlbnRpZmllZCBieSBgY29tbWl0bWVudGAuCgpJZiBhbiBpZGVudGl0eSBWSyBoYXMgYmVlbiByZWdpc3RlcmVkIChgc2V0X2lkZW50aXR5X3ZrYCksIGBwcm9vZl9ieXRlc2AKbXVzdCBiZSBhIHZhbGlkIEdyb3RoMTYgcHJvb2Ygd2hvc2UgcHVibGljIGlucHV0IGVxdWFscyBgY29tbWl0bWVudGAg4oCUCmkuZS4gdGhlIGNhbGxlciBwcm92ZXMga25vd2xlZGdlIG9mIHRoZSBzZWNyZXQgd2l0aG91dCByZXZlYWxpbmcgaXQuCklmIG5vIFZLIGlzIHNldCwgcmVnaXN0cmF0aW9uIGlzIG9wdGltaXN0aWMgKHByb29mIGlnbm9yZWQpLgAAAA9yZWdpc3Rlcl93YWxsZXQAAAAAAwAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAAAAAAALcHJvb2ZfYnl0ZXMAAAAADgAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAANBSZWdpc3RlciB0aGUgR3JvdGgxNiB2ZXJpZmljYXRpb24ga2V5IGZvciB0aGUgUG9zZWlkb24gaWRlbnRpdHkgY2lyY3VpdC4KQWRtaW4tb25seS4gT25jZSBzZXQsIGByZWdpc3Rlcl93YWxsZXRgIHJlcXVpcmVzIGEgdmFsaWQgcHJvb2YgdGhhdCB0aGUKY2FsbGVyIGtub3dzIHRoZSBzZWNyZXQgYmVoaW5kIHRoZSBjb21taXRtZW50IGJlaW5nIHJlZ2lzdGVyZWQuAAAAD3NldF9pZGVudGl0eV92awAAAAABAAAAAAAAAAh2a19ieXRlcwAAAA4AAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAHBVcGRhdGUgdGhlIGFnZ3JlZ2F0ZWQgZ3JvdXAgYXR0ZXN0YXRpb24gZm9yIGEgY29tbWl0bWVudC4KSW4gdjEgdGhpcyBpcyBhIHN0dWIgdXNlZCBieSB0aGUgUmlza0F0dGVzdGF0aW9uIGZsb3cuAAAAEnVwZGF0ZV9ncm91cF9zY29yZQAAAAAAAgAAAAAAAAAKY29tbWl0bWVudAAAAAAD7gAAACAAAAAAAAAAC2F0dGVzdGF0aW9uAAAAB9AAAAAPQXR0ZXN0YXRpb25EYXRhAAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAEBSZXR1cm4gdGhlIGFnZ3JlZ2F0ZWQgYXR0ZXN0YXRpb24gZm9yIGFuIGlkZW50aXR5IGdyb3VwLCBpZiBhbnkuAAAAFWdldF9ncm91cF9hdHRlc3RhdGlvbgAAAAAAAAEAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAQAAA+gAAAfQAAAAD0F0dGVzdGF0aW9uRGF0YQA=",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAADgAAAAAAAAAPQWxyZWFkeUF0dGVzdGVkAAAAAAEAAAAAAAAADU5vdEF1dGhvcml6ZWQAAAAAAAACAAAAAAAAABNBdHRlc3RhdGlvbk5vdEZvdW5kAAAAAAMAAAAAAAAAEkF0dGVzdGF0aW9uRXhwaXJlZAAAAAAABAAAAAAAAAAMSW52YWxpZFByb29mAAAABQAAAAAAAAAVQXR0ZXN0b3JOb3RSZWdpc3RlcmVkAAAAAAAABgAAAAAAAAAPQXR0ZXN0b3JSZXZva2VkAAAAAAcAAAAAAAAAD01vZGVsRGVwcmVjYXRlZAAAAAAIAAAAAAAAAA1JbnZhbGlkSW5wdXRzAAAAAAAACQAAAAAAAAAOS3ljTm90VmVyaWZpZWQAAAAAAAoAAABYV2FsbGV0IHRyaWVkIHRvIGpvaW4gYSBncm91cCB3aXRoIGEgY29tbWl0bWVudCBkaWZmZXJlbnQgZnJvbSBvbmUgaXQgYWxyZWFkeSByZWdpc3RlcmVkLgAAABJDb21taXRtZW50Q29uZmxpY3QAAAAAAAsAAAAAAAAADkFscmVhZHlJbkdyb3VwAAAAAAAMAAAAPUNhbGxlciBpcyBub3QgYW4gYXV0aG9yaXplZCBhdHRlc3RvciBpbiB0aGUgQXR0ZXN0b3JSZWdpc3RyeS4AAAAAAAAUVW5hdXRob3JpemVkQXR0ZXN0b3IAAAANAAAARlJJU0MgWmVybyBndWVzdCBpbWFnZSBpZCBoYXMgbm90IGJlZW4gcmVnaXN0ZXJlZCAoc2V0X3Jpc2MwX2ltYWdlX2lkKS4AAAAAABBSaXNjMEltYWdlTm90U2V0AAAADg==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAADAAAAAEAAAAAAAAAC0F0dGVzdGF0aW9uAAAAAAEAAAATAAAAAQAAAAAAAAAIQXR0ZXN0b3IAAAABAAAAEwAAAAAAAAAAAAAABUFkbWluAAAAAAAAAQAAAIFHcm90aDE2IHZlcmlmaWNhdGlvbiBrZXksIGtleWVkIGJ5IGRpc3RpbGxlZF9tb2RlbF9oYXNoLgpSZWdpc3RlcmVkIGJ5IGFkbWluOyBlbmFibGVzIG9uLWNoYWluIHByb29mIHZlcmlmaWNhdGlvbiBmb3IgdGhhdCBtb2RlbC4AAAAAAAAPVmVyaWZpY2F0aW9uS2V5AAAAAAEAAAPuAAAAIAAAAAEAAABTTWFwcyBhIHdhbGxldCBhZGRyZXNzIHRvIGl0cyBQb3NlaWRvbiBpZGVudGl0eSBjb21taXRtZW50IChtdWx0aS13YWxsZXQgZ3JvdXAga2V5KS4AAAAAEFdhbGxldENvbW1pdG1lbnQAAAABAAAAEwAAAAEAAABKQWdncmVnYXRlZCBncm91cCBBdHRlc3RhdGlvbkRhdGEsIGtleWVkIGJ5IHRoZSBzaGFyZWQgUG9zZWlkb24gY29tbWl0bWVudC4AAAAAABNJZGVudGl0eUF0dGVzdGF0aW9uAAAAAAEAAAPuAAAAIAAAAAEAAABEQ291bnQgb2Ygd2FsbGV0cyBlbnJvbGxlZCBpbiBhbiBpZGVudGl0eSBncm91cCAoY29tbWl0bWVudCDihpIgdTMyKS4AAAATSWRlbnRpdHlNZW1iZXJDb3VudAAAAAABAAAD7gAAACAAAAAAAAAAj0dyb3RoMTYgVksgZm9yIHRoZSBQb3NlaWRvbiBpZGVudGl0eSBjaXJjdWl0LCBzdG9yZWQgYnkgV2FsbGV0SWRlbnRpdHkuCldoZW4gc2V0LCBgcmVnaXN0ZXJfd2FsbGV0YCByZXF1aXJlcyBhIHZhbGlkIHByb29mIG9mIHNlY3JldCBrbm93bGVkZ2UuAAAAABdJZGVudGl0eVZlcmlmaWNhdGlvbktleQAAAAAAAAAAmVdoaXRlbGlzdGVkIFJJU0MgWmVybyBndWVzdCBpbWFnZSBpZCAodGhlIGRpc3RpbGxlZC1tb2RlbCBndWVzdCksIHN0b3JlZCBieQpSaXNrQXR0ZXN0YXRpb24uIE9ubHkgcmVjZWlwdHMgZnJvbSB0aGlzIGltYWdlIHZlcmlmeSBpbiBgYXR0ZXN0X3dpdGhfcmlzYzBgLgAAAAAAAAxSaXNjMEltYWdlSWQAAAAAAAAAWVdhbGxldElkZW50aXR5IGNvbnRyYWN0IGFkZHJlc3MsIHN0b3JlZCBieSBSaXNrQXR0ZXN0YXRpb24gZm9yIGNyb3NzLWNvbnRyYWN0IHJlc29sdXRpb24uAAAAAAAAFldhbGxldElkZW50aXR5Q29udHJhY3QAAAAAAAAAAABNQWRkcmVzcyBvZiB0aGUgQXR0ZXN0b3JSZWdpc3RyeSBjb250cmFjdCB1c2VkIHRvIHZhbGlkYXRlIGF0dGVzdG9yIGFkZHJlc3Nlcy4AAAAAAAAQQXR0ZXN0b3JSZWdpc3RyeQAAAAAAAABcQWRkcmVzcyBvZiB0aGUgUmlza0F0dGVzdGF0aW9uIGNvbnRyYWN0IHVzZWQgYnkgZG93bnN0cmVhbSBjb25zdW1lcnMgKGUuZy4gTW9ja0xlbmRpbmdQb29sKS4AAAAPUmlza0F0dGVzdGF0aW9uAA==",
        "AAAAAQAAAKFDb21tb24gb24tY2hhaW4gYXR0ZXN0YXRpb24gcmVjb3JkLgpQZXIgdGhlIFpLcmVkaXQgc3BlYywgb25seSByaXNrIGJ1Y2tldCwgY29uZmlkZW5jZSwgaGFzaGVzLCB0aW1lc3RhbXBzLAphdHRlc3RvciwgYW5kIHdhbGxldCBnbyBvbi1jaGFpbi4gTm8gcmF3IHdhbGxldCBkYXRhLgAAAAAAAAAAAAAPQXR0ZXN0YXRpb25EYXRhAAAAAAwAAAAAAAAACGF0dGVzdG9yAAAAEwAAAAAAAAAKY29uZmlkZW5jZQAAAAAABAAAAAAAAAAUZGlzdGlsbGVkX21vZGVsX2hhc2gAAAPuAAAAIAAAAAAAAAAKZXhwaXJlc19hdAAAAAAABgAAAAAAAAAPZnVsbF9tb2RlbF9oYXNoAAAAA+4AAAAgAAAAiVBvc2VpZG9uKHNlY3JldCkgY29tbWl0bWVudCB0aGF0IGxpbmtzIHRoaXMgd2FsbGV0IHRvIGFuIGlkZW50aXR5IGdyb3VwLgpOb25lIG1lYW5zIHRoZSB3YWxsZXQgaXMgbm90IGVucm9sbGVkIGluIGFueSBtdWx0aS13YWxsZXQgZ3JvdXAuAAAAAAAAE2lkZW50aXR5X2NvbW1pdG1lbnQAAAAD6AAAA+4AAAAgAAAAAAAAAAlpc3N1ZWRfYXQAAAAAAAAGAAAAVEF0dGVzdG9yLWNlcnRpZmllZCBLWUMgc3RhdHVzLiBVbmxvY2tzIOKIkjEwMCBicHMgQVBSIGRpc2NvdW50IGluIGxlbmRpbmcgY29udHJhY3RzLgAAAAxreWNfdmVyaWZpZWQAAAABAAAAAAAAAA1wcm9vZl9vcl9oYXNoAAAAAAAD7gAAACAAAAAAAAAAC3Jpc2tfYnVja2V0AAAAAAQAAAAAAAAABndhbGxldAAAAAAAEwAAAAAAAAALemtfdmVyaWZpZWQAAAAAAQ==",
        "AAAABQAAACNTdGFuZGFyZCBhdHRlc3RhdGlvbi13cml0dGVuIGV2ZW50LgAAAAAAAAAAEkF0dGVzdGF0aW9uV3JpdHRlbgAAAAAAAQAAAAZhdHRlc3QAAAAAAAQAAAAAAAAABndhbGxldAAAAAAAEwAAAAEAAAAAAAAACGF0dGVzdG9yAAAAEwAAAAEAAAAAAAAAC3Jpc2tfYnVja2V0AAAAAAQAAAABAAAAAAAAAARkYXRhAAAH0AAAAA9BdHRlc3RhdGlvbkRhdGEAAAAAAAAAAAI=" ]),
      options
    )
  }
  public readonly fromJSON = {
    leave_group: this.txFromJSON<Result<void>>,
        register_wallet: this.txFromJSON<Result<void>>,
        set_identity_vk: this.txFromJSON<Result<void>>,
        update_group_score: this.txFromJSON<Result<void>>,
        get_group_attestation: this.txFromJSON<Option<AttestationData>>
  }
}