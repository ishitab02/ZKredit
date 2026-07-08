import { afterEach, describe, expect, it, vi } from "vitest";

import { prepareAttestation } from "./attestor";

const WALLET = "G" + "A".repeat(55);

const okJson = (body: unknown) => ({ ok: true, json: async () => body });

describe("prepareAttestation (async job model, 2.3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("session -> enqueue -> poll to succeeded, returning the co-sign result", async () => {
    vi.useFakeTimers();
    const result = {
      partial_xdr: "XDR==",
      risk_bucket: 2,
      confidence: 0.9,
      distilled_model_hash: "bb",
      submission_mode: "live_cosign",
      submission_detail: "ok",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ status: "ok" })) // auth/session
      .mockResolvedValueOnce(
        okJson({ job_id: "job1", status: "queued", stellar_address: WALLET, result: null }),
      ) // prepare -> queued
      .mockResolvedValueOnce(
        okJson({ job_id: "job1", status: "proving", stellar_address: WALLET, result: null }),
      ) // first poll -> still proving
      .mockResolvedValueOnce(
        okJson({ job_id: "job1", status: "succeeded", submission_mode: "live_cosign", result }),
      ); // second poll -> done
    vi.stubGlobal("fetch", fetchMock);

    const phases: string[] = [];
    const promise = prepareAttestation(WALLET, (p) => phases.push(p));
    await vi.advanceTimersByTimeAsync(5000); // walk past both 2s poll intervals
    const resolved = await promise;

    expect(resolved.partial_xdr).toBe("XDR==");
    expect(resolved.submission_mode).toBe("live_cosign");
    expect(phases).toContain("proving");

    const [sessionUrl, sessionOpts] = fetchMock.mock.calls[0];
    expect(String(sessionUrl)).toContain("/api/v1/auth/session");
    expect(sessionOpts.credentials).toBe("include");
    const [prepareUrl] = fetchMock.mock.calls[1];
    expect(String(prepareUrl)).toContain(`/api/v1/attest/${WALLET}/prepare`);
    const [pollUrl] = fetchMock.mock.calls[2];
    expect(String(pollUrl)).toContain("/api/v1/attest/jobs/job1");
  });

  it("throws the API's detail message on a non-ok prepare response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({}))
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ detail: "rate limited" }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(prepareAttestation(WALLET)).rejects.toThrow("rate limited");
  });

  it("throws the job's error_detail when proving fails", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ status: "ok" }))
      .mockResolvedValueOnce(okJson({ job_id: "j2", status: "queued", result: null }))
      .mockResolvedValueOnce(
        okJson({ job_id: "j2", status: "failed", error_detail: "prover exploded", result: null }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const promise = prepareAttestation(WALLET);
    const assertion = expect(promise).rejects.toThrow("prover exploded");
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });
});
