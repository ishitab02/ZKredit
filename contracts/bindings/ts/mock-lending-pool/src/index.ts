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





export interface LoanOffer {
  apr_basis_points: u32;
  collateral_ratio_basis_points: u32;
  max_principal: i128;
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
   * Construct and simulate a execute_loan transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  execute_loan: ({wallet}: {wallet: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_loan_terms transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_loan_terms: ({wallet}: {wallet: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<LoanOffer>>>

  /**
   * Construct and simulate a set_risk_attestation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set the RiskAttestation contract address. Admin-only.
   */
  set_risk_attestation: ({contract_id}: {contract_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
      new ContractSpec([ "AAAAAQAAAAAAAAAAAAAACUxvYW5PZmZlcgAAAAAAAAMAAAAAAAAAEGFwcl9iYXNpc19wb2ludHMAAAAEAAAAAAAAAB1jb2xsYXRlcmFsX3JhdGlvX2Jhc2lzX3BvaW50cwAAAAAAAAQAAAAAAAAADW1heF9wcmluY2lwYWwAAAAAAAAL",
        "AAAAAAAAAAAAAAAMZXhlY3V0ZV9sb2FuAAAAAQAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAOZ2V0X2xvYW5fdGVybXMAAAAAAAEAAAAAAAAABndhbGxldAAAAAAAEwAAAAEAAAPpAAAH0AAAAAlMb2FuT2ZmZXIAAAAAAAAD",
        "AAAAAAAAADVTZXQgdGhlIFJpc2tBdHRlc3RhdGlvbiBjb250cmFjdCBhZGRyZXNzLiBBZG1pbi1vbmx5LgAAAAAAABRzZXRfcmlza19hdHRlc3RhdGlvbgAAAAEAAAAAAAAAC2NvbnRyYWN0X2lkAAAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAEAAAAAAAAAAPQWxyZWFkeUF0dGVzdGVkAAAAAAEAAAAAAAAADU5vdEF1dGhvcml6ZWQAAAAAAAACAAAAAAAAABNBdHRlc3RhdGlvbk5vdEZvdW5kAAAAAAMAAAAAAAAAEkF0dGVzdGF0aW9uRXhwaXJlZAAAAAAABAAAAAAAAAAMSW52YWxpZFByb29mAAAABQAAAAAAAAAVQXR0ZXN0b3JOb3RSZWdpc3RlcmVkAAAAAAAABgAAAAAAAAAPQXR0ZXN0b3JSZXZva2VkAAAAAAcAAAAAAAAAD01vZGVsRGVwcmVjYXRlZAAAAAAIAAAAAAAAAA1JbnZhbGlkSW5wdXRzAAAAAAAACQAAAAAAAAAOS3ljTm90VmVyaWZpZWQAAAAAAAoAAABYV2FsbGV0IHRyaWVkIHRvIGpvaW4gYSBncm91cCB3aXRoIGEgY29tbWl0bWVudCBkaWZmZXJlbnQgZnJvbSBvbmUgaXQgYWxyZWFkeSByZWdpc3RlcmVkLgAAABJDb21taXRtZW50Q29uZmxpY3QAAAAAAAsAAAAAAAAADkFscmVhZHlJbkdyb3VwAAAAAAAMAAAAPUNhbGxlciBpcyBub3QgYW4gYXV0aG9yaXplZCBhdHRlc3RvciBpbiB0aGUgQXR0ZXN0b3JSZWdpc3RyeS4AAAAAAAAUVW5hdXRob3JpemVkQXR0ZXN0b3IAAAANAAAARlJJU0MgWmVybyBndWVzdCBpbWFnZSBpZCBoYXMgbm90IGJlZW4gcmVnaXN0ZXJlZCAoc2V0X3Jpc2MwX2ltYWdlX2lkKS4AAAAAABBSaXNjMEltYWdlTm90U2V0AAAADgAAAJBSZS1hdHRlc3RhdGlvbiBjYXJyaWVkIGFuIGBpc3N1ZWRfYXRgIG5vdCBzdHJpY3RseSBuZXdlciB0aGFuIHRoZSBzdG9yZWQKb25lIOKAlCByZWplY3RlZCBzbyBhbiBvbGRlciAocG9zc2libHkgYmV0dGVyKSBzY29yZSBjYW4ndCBiZSByZXBsYXllZC4AAAAQU3RhbGVBdHRlc3RhdGlvbgAAAA8AAACXVGhpcyBLWUMgbnVsbGlmaWVyIGlzIGFscmVhZHkgYm91bmQgdG8gYSAqZGlmZmVyZW50KiBpZGVudGl0eSBjb21taXRtZW50IOKAlAp0aGUgc2FtZSB2ZXJpZmllZCBodW1hbiBjYW5ub3QgbWludCBhIHNlY29uZCBpZGVudGl0eSBncm91cCAoU3liaWwgYmxvY2spLgAAAAAVTnVsbGlmaWVyQWxyZWFkeUJvdW5kAAAAAAAAEA==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAADgAAAAEAAAAAAAAAC0F0dGVzdGF0aW9uAAAAAAEAAAATAAAAAQAAAAAAAAAIQXR0ZXN0b3IAAAABAAAAEwAAAAAAAAAAAAAABUFkbWluAAAAAAAAAQAAAIFHcm90aDE2IHZlcmlmaWNhdGlvbiBrZXksIGtleWVkIGJ5IGRpc3RpbGxlZF9tb2RlbF9oYXNoLgpSZWdpc3RlcmVkIGJ5IGFkbWluOyBlbmFibGVzIG9uLWNoYWluIHByb29mIHZlcmlmaWNhdGlvbiBmb3IgdGhhdCBtb2RlbC4AAAAAAAAPVmVyaWZpY2F0aW9uS2V5AAAAAAEAAAPuAAAAIAAAAAEAAABTTWFwcyBhIHdhbGxldCBhZGRyZXNzIHRvIGl0cyBQb3NlaWRvbiBpZGVudGl0eSBjb21taXRtZW50IChtdWx0aS13YWxsZXQgZ3JvdXAga2V5KS4AAAAAEFdhbGxldENvbW1pdG1lbnQAAAABAAAAEwAAAAEAAABKQWdncmVnYXRlZCBncm91cCBBdHRlc3RhdGlvbkRhdGEsIGtleWVkIGJ5IHRoZSBzaGFyZWQgUG9zZWlkb24gY29tbWl0bWVudC4AAAAAABNJZGVudGl0eUF0dGVzdGF0aW9uAAAAAAEAAAPuAAAAIAAAAAEAAABEQ291bnQgb2Ygd2FsbGV0cyBlbnJvbGxlZCBpbiBhbiBpZGVudGl0eSBncm91cCAoY29tbWl0bWVudCDihpIgdTMyKS4AAAATSWRlbnRpdHlNZW1iZXJDb3VudAAAAAABAAAD7gAAACAAAAAAAAAAj0dyb3RoMTYgVksgZm9yIHRoZSBQb3NlaWRvbiBpZGVudGl0eSBjaXJjdWl0LCBzdG9yZWQgYnkgV2FsbGV0SWRlbnRpdHkuCldoZW4gc2V0LCBgcmVnaXN0ZXJfd2FsbGV0YCByZXF1aXJlcyBhIHZhbGlkIHByb29mIG9mIHNlY3JldCBrbm93bGVkZ2UuAAAAABdJZGVudGl0eVZlcmlmaWNhdGlvbktleQAAAAAAAAAAmVdoaXRlbGlzdGVkIFJJU0MgWmVybyBndWVzdCBpbWFnZSBpZCAodGhlIGRpc3RpbGxlZC1tb2RlbCBndWVzdCksIHN0b3JlZCBieQpSaXNrQXR0ZXN0YXRpb24uIE9ubHkgcmVjZWlwdHMgZnJvbSB0aGlzIGltYWdlIHZlcmlmeSBpbiBgYXR0ZXN0X3dpdGhfcmlzYzBgLgAAAAAAAAxSaXNjMEltYWdlSWQAAAAAAAAAWVdhbGxldElkZW50aXR5IGNvbnRyYWN0IGFkZHJlc3MsIHN0b3JlZCBieSBSaXNrQXR0ZXN0YXRpb24gZm9yIGNyb3NzLWNvbnRyYWN0IHJlc29sdXRpb24uAAAAAAAAFldhbGxldElkZW50aXR5Q29udHJhY3QAAAAAAAAAAABNQWRkcmVzcyBvZiB0aGUgQXR0ZXN0b3JSZWdpc3RyeSBjb250cmFjdCB1c2VkIHRvIHZhbGlkYXRlIGF0dGVzdG9yIGFkZHJlc3Nlcy4AAAAAAAAQQXR0ZXN0b3JSZWdpc3RyeQAAAAAAAABcQWRkcmVzcyBvZiB0aGUgUmlza0F0dGVzdGF0aW9uIGNvbnRyYWN0IHVzZWQgYnkgZG93bnN0cmVhbSBjb25zdW1lcnMgKGUuZy4gTW9ja0xlbmRpbmdQb29sKS4AAAAPUmlza0F0dGVzdGF0aW9uAAAAAAEAAAEYU3liaWwtcmVzaXN0YW5jZSByZWdpc3RyeTogbWFwcyBhbiBvcGFxdWUgS1lDIG51bGxpZmllciAoSE1BQyBvZiB0aGUKdmVyaWZpZWQgZG9jdW1lbnQsIGNvbXB1dGVkIG9mZi1jaGFpbiDigJQgbmV2ZXIgcmF3IFBJSSkgdG8gdGhlIHNpbmdsZQppZGVudGl0eSBjb21taXRtZW50IGl0IGlzIGJvdW5kIHRvLiBPbmUgdmVyaWZpZWQgaHVtYW4g4oaSIG9uZSBudWxsaWZpZXIg4oaSCmF0IG1vc3Qgb25lIGlkZW50aXR5IGdyb3VwLiBTdG9yZWQgYnkgV2FsbGV0SWRlbnRpdHk6OmJpbmRfa3ljLgAAABNOdWxsaWZpZXJDb21taXRtZW50AAAAAAEAAAPuAAAAIAAAAAEAAADSV2hldGhlciBhbiBpZGVudGl0eSBncm91cCAoY29tbWl0bWVudCkgaGFzIGEgYm91bmQgS1lDIG51bGxpZmllciwgaS5lLiBpcwpLWUMtdmVyaWZpZWQuIFNldCBieSBiaW5kX2t5Yzsgb3ZlcmxhaWQgb250byB0aGUgZ3JvdXAgQXR0ZXN0YXRpb25EYXRhIHNvCktZQyBzdXJ2aXZlcyByZWdhcmRsZXNzIG9mIHNjb3Jpbmcgb3JkZXIuIGNvbW1pdG1lbnQg4oaSIGJvb2wuAAAAAAALS3ljVmVyaWZpZWQAAAAAAQAAA+4AAAAg",
        "AAAAAQAAAKFDb21tb24gb24tY2hhaW4gYXR0ZXN0YXRpb24gcmVjb3JkLgpQZXIgdGhlIFpLcmVkaXQgc3BlYywgb25seSByaXNrIGJ1Y2tldCwgY29uZmlkZW5jZSwgaGFzaGVzLCB0aW1lc3RhbXBzLAphdHRlc3RvciwgYW5kIHdhbGxldCBnbyBvbi1jaGFpbi4gTm8gcmF3IHdhbGxldCBkYXRhLgAAAAAAAAAAAAAPQXR0ZXN0YXRpb25EYXRhAAAAAAwAAAAAAAAACGF0dGVzdG9yAAAAEwAAAAAAAAAKY29uZmlkZW5jZQAAAAAABAAAAAAAAAAUZGlzdGlsbGVkX21vZGVsX2hhc2gAAAPuAAAAIAAAAAAAAAAKZXhwaXJlc19hdAAAAAAABgAAAAAAAAAPZnVsbF9tb2RlbF9oYXNoAAAAA+4AAAAgAAAAiVBvc2VpZG9uKHNlY3JldCkgY29tbWl0bWVudCB0aGF0IGxpbmtzIHRoaXMgd2FsbGV0IHRvIGFuIGlkZW50aXR5IGdyb3VwLgpOb25lIG1lYW5zIHRoZSB3YWxsZXQgaXMgbm90IGVucm9sbGVkIGluIGFueSBtdWx0aS13YWxsZXQgZ3JvdXAuAAAAAAAAE2lkZW50aXR5X2NvbW1pdG1lbnQAAAAD6AAAA+4AAAAgAAAAAAAAAAlpc3N1ZWRfYXQAAAAAAAAGAAAA9UF0dGVzdG9yLWNlcnRpZmllZCBLWUMgc3RhdHVzLCBib3VuZCB2aWEgYSBTeWJpbC1yZXNpc3RhbnQgbnVsbGlmaWVyCihXYWxsZXRJZGVudGl0eTo6YmluZF9reWMpLiBUaGUgY3JlZGl0ICpnYXRlKiBpbiBsZW5kaW5nOiBvbmx5IGEKa3ljX3ZlcmlmaWVkIGlkZW50aXR5IGdldHMgcmVhbCBib3Jyb3dpbmcgY2FwYWNpdHkgKGFudGktd2FsbGV0LWhvcHBpbmcpOwp1bi1LWUMnZCB3YWxsZXRzIGdldCB0aGluLWZpbGUgdGVybXMuAAAAAAAADGt5Y192ZXJpZmllZAAAAAEAAAAAAAAADXByb29mX29yX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAALcmlza19idWNrZXQAAAAABAAAAAAAAAAGd2FsbGV0AAAAAAATAAAAAAAAAAt6a192ZXJpZmllZAAAAAAB",
        "AAAABQAAACNTdGFuZGFyZCBhdHRlc3RhdGlvbi13cml0dGVuIGV2ZW50LgAAAAAAAAAAEkF0dGVzdGF0aW9uV3JpdHRlbgAAAAAAAQAAAAZhdHRlc3QAAAAAAAQAAAAAAAAABndhbGxldAAAAAAAEwAAAAEAAAAAAAAACGF0dGVzdG9yAAAAEwAAAAEAAAAAAAAAC3Jpc2tfYnVja2V0AAAAAAQAAAABAAAAAAAAAARkYXRhAAAH0AAAAA9BdHRlc3RhdGlvbkRhdGEAAAAAAAAAAAI=" ]),
      options
    )
  }
  public readonly fromJSON = {
    execute_loan: this.txFromJSON<boolean>,
        get_loan_terms: this.txFromJSON<Result<LoanOffer>>,
        set_risk_attestation: this.txFromJSON<Result<void>>
  }
}