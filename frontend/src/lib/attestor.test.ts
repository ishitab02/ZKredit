import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getAttestationJob,
  prepareAttestation,
} from "./attestor";

const WALLET = "G" + "A".repeat(55);

describe("prepareAttestation (unified API cutover, 1.7)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("establishes a session, then calls the prepare endpoint with credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ok" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          partial_xdr: "XDR==",
          risk_bucket: 2,
          confidence: 0.9,
          distilled_model_hash: "bb",
          submission_mode: "live_cosign",
          submission_detail: "ok",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await prepareAttestation(WALLET);

    expect(result.partial_xdr).toBe("XDR==");
    expect(result.submission_mode).toBe("live_cosign");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [sessionUrl, sessionOpts] = fetchMock.mock.calls[0];
    expect(String(sessionUrl)).toContain("/api/v1/auth/session");
    expect(sessionOpts.credentials).toBe("include");

    const [prepareUrl, prepareOpts] = fetchMock.mock.calls[1];
    expect(String(prepareUrl)).toContain(`/api/v1/attest/${WALLET}/prepare`);
    expect(prepareOpts.credentials).toBe("include");
  });

  it("polls queued jobs to a final prepared attestation and reports phases", async () => {
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: TimerHandler) => {
      if (typeof fn === "function") fn();
      return 0;
    }) as typeof setTimeout);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ok" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          job_id: "job-123",
          status: "queued",
          risk_bucket: 2,
          confidence: 0.9,
          distilled_model_hash: "bb",
          submission_mode: "live_cosign",
          submission_detail: "waiting",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          job_id: "job-123",
          status: "proving",
          risk_bucket: 2,
          confidence: 0.9,
          distilled_model_hash: "bb",
          submission_mode: "live_cosign",
          submission_detail: "proving",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          partial_xdr: "XDR==",
          stellar_address: WALLET,
          risk_bucket: 2,
          risk_bucket_name: "MEDIUM",
          confidence: 0.9,
          credit_score: 640,
          full_model_hash: "aa",
          distilled_model_hash: "bb",
          zk_verified: false,
          proof_generated: true,
          proof_hash: "cc",
          public_inputs: [],
          anomaly: false,
          anomaly_score: 0,
          top_features: [],
          reason_codes: [],
          feature_schema_version: "v1",
          created_at: "2026-07-09T00:00:00Z",
          submission_mode: "live_cosign",
          submission_detail: "done",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const phases: string[] = [];
    const result = await prepareAttestation(WALLET, (phase, meta) => {
      phases.push(`${phase}:${meta.status}`);
    });

    expect(result.partial_xdr).toBe("XDR==");
    expect(phases).toEqual(["queued:queued", "proving:proving"]);
  });

  it("throws the API's detail message on a non-ok prepare response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ detail: "rate limited" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(prepareAttestation(WALLET)).rejects.toThrow("rate limited");
  });

  it("reads a queued job status with credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        job_id: "job-123",
        status: "queued",
        risk_bucket: 2,
        confidence: 0.9,
        distilled_model_hash: "bb",
        submission_mode: "live_cosign",
        submission_detail: "waiting",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getAttestationJob("job-123");

    expect("job_id" in result && result.job_id).toBe("job-123");
    const [jobUrl, jobOpts] = fetchMock.mock.calls[0];
    expect(String(jobUrl)).toContain("/api/v1/attest/jobs/job-123");
    expect(jobOpts.credentials).toBe("include");
  });

  it("maps missing job-status support to a dedicated error", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "not found" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAttestationJob("job-404")).rejects.toMatchObject({
      kind: "job_status_unavailable",
    });
  });
});
