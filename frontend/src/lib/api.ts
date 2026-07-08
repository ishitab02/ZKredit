export const API_BASE = import.meta.env.VITE_API_URL ?? "";

export interface TopFeature {
  name: string;
  value: number;
  contribution: number;
}

export interface ReasonCode {
  code: string;
  label: string;
}

export interface AttestationResponse {
  stellar_address: string;
  risk_bucket: number;
  risk_bucket_name: string;
  confidence: number;
  credit_score: number;
  full_model_hash: string;
  distilled_model_hash: string;
  zk_verified: boolean;
  proof_generated: boolean;
  proof_hash: string;
  public_inputs: string[];
  anomaly: boolean;
  anomaly_score: number;
  top_features: TopFeature[];
  reason_codes: ReasonCode[];
  feature_schema_version: string;
  tx_hash: string | null;
  created_at: string;
}

export interface AttestationRecordResponse {
  stellar_address: string;
  risk_bucket: number;
  confidence_bps: number;
  full_model_hash: string;
  distilled_model_hash: string;
  proof_hash: string;
  zk_verified: boolean;
  attestor: string;
  issued_at: number;
  expires_at: number;
  submission_mode: string;
  submission_detail: string;
  tx_hash: string;
  created_at: string;
}

export interface FeatureSummaryResponse {
  stellar_address: string;
  feature_schema_version: string;
  dimension: number;
  summary: Record<string, number>;
}

export interface ModelInfoResponse {
  full_model_hash: string;
  distilled_model_hash: string;
  feature_schema_version: string;
  feature_dimension: number;
  distilled_features: string[];
  distilled_model_type: string;
  distilled_top_k: number;
  distilled_feature_space: string;
  distilled_exact_fidelity: number;
  distilled_within_one_fidelity: number;
  zk_verified_capability: boolean;
  proving_system: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(0, "Could not reach the attestation service.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : res.statusText;
    throw new ApiError(res.status, detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function isValidStellarAddress(address: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(address.trim());
}

export function requestAttestation(address: string): Promise<AttestationResponse> {
  return apiFetch<AttestationResponse>(`/api/v1/attest/${encodeURIComponent(address)}`, {
    method: "POST",
  });
}

export function getAttestationRecord(address: string): Promise<AttestationRecordResponse> {
  return apiFetch<AttestationRecordResponse>(
    `/api/v1/attestation/${encodeURIComponent(address)}`,
  );
}

export function getWalletFeatures(address: string): Promise<FeatureSummaryResponse> {
  return apiFetch<FeatureSummaryResponse>(
    `/api/v1/wallet/${encodeURIComponent(address)}/features`,
  );
}

export function getModelInfo(): Promise<ModelInfoResponse> {
  return apiFetch<ModelInfoResponse>("/api/v1/model-info");
}
