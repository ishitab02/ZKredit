import { fireEvent, render, screen } from "@testing-library/react";
import OnChainAttest from "./OnChainAttest";

const mocks = vi.hoisted(() => {
  class MockFreighterError extends Error {
    declare kind:
      | "extension_missing"
      | "authorization_failed"
      | "address_unavailable"
      | "wrong_network"
      | "sign_rejected"
      | "unknown";
  }

  class MockAttestationPrepareError extends Error {
    declare kind:
      | "api_unreachable"
      | "session_failed"
      | "prepare_unavailable"
      | "job_status_unavailable"
      | "job_failed"
      | "rate_limited"
      | "already_attested"
      | "request_failed";
  }

  return {
    connectFreighter: vi.fn(),
    getConnectedAddress: vi.fn(),
    prepareAttestation: vi.fn(),
    getAttestationJob: vi.fn(),
    FreighterError: MockFreighterError,
    AttestationPrepareError: MockAttestationPrepareError,
  };
});

vi.mock("../lib/freighter", () => ({
  FreighterError: mocks.FreighterError,
  connectFreighter: mocks.connectFreighter,
  getConnectedAddress: mocks.getConnectedAddress,
}));

vi.mock("../lib/attestor", () => ({
  AttestationPrepareError: mocks.AttestationPrepareError,
  prepareAttestation: mocks.prepareAttestation,
  getAttestationJob: mocks.getAttestationJob,
  isQueuedAttestation: (result: unknown) =>
    typeof result === "object" && result !== null && "job_id" in result,
}));

function makeFreighterError(
  kind: InstanceType<typeof mocks.FreighterError>["kind"],
  message: string,
) {
  const error = new mocks.FreighterError(message);
  error.kind = kind;
  return error;
}

function makePrepareError(
  kind: InstanceType<typeof mocks.AttestationPrepareError>["kind"],
  message: string,
) {
  const error = new mocks.AttestationPrepareError(message);
  error.kind = kind;
  return error;
}

describe("OnChainAttest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnectedAddress.mockResolvedValue(null);
  });

  it("shows a wrong-network message when Freighter is not on testnet", async () => {
    mocks.connectFreighter.mockRejectedValueOnce(
      makeFreighterError("wrong_network", "wrong network"),
    );

    render(<OnChainAttest />);
    fireEvent.click(screen.getByRole("button", { name: /connect freighter/i }));

    await screen.findByText("Wrong Freighter network");
    expect(
      screen.getByText(/switch the extension to testnet/i),
    ).toBeInTheDocument();
  });

  it("shows a rate-limit error when attestation preparation is throttled", async () => {
    mocks.prepareAttestation.mockRejectedValueOnce(
      makePrepareError("rate_limited", "rate limited"),
    );

    render(<OnChainAttest walletAddress={"G" + "A".repeat(55)} />);
    fireEvent.click(screen.getByRole("button", { name: /request attestation/i }));

    await screen.findByText("Attestation temporarily rate-limited");
    expect(
      screen.getByText(/reached the current attestation limit/i),
    ).toBeInTheDocument();
  });

  it("renders the queued proving state when prepare returns a job id", async () => {
    mocks.prepareAttestation.mockResolvedValueOnce({
      job_id: "job-123",
      status: "queued",
      risk_bucket: 2,
      confidence: 0.9,
      distilled_model_hash: "bb",
      submission_mode: "live_cosign",
      submission_detail: "waiting",
    });

    render(<OnChainAttest walletAddress={"G" + "A".repeat(55)} />);
    fireEvent.click(screen.getByRole("button", { name: /request attestation/i }));

    await screen.findByText(/job job-123/i);
    expect(screen.getByText(/live proof/i)).toBeInTheDocument();
  });
});
