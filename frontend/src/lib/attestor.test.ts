import { afterEach, describe, expect, it, vi } from "vitest";

import { prepareAttestation } from "./attestor";

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
});
