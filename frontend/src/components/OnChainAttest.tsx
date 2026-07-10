import { useEffect, useState } from "react";
import { connectFreighter, FreighterError, getConnectedAddress } from "../lib/freighter";
import {
  AttestationPrepareError,
  prepareAttestation,
  type AttestationPreparePhaseMeta,
  type PreparedAttestation,
} from "../lib/attestor";
import { type AttestationData } from "../lib/contracts";
import { ContractRpcError } from "../lib/contracts/errors";
import RevealStepper, { type StepperMode } from "./attestation/RevealStepper";
import AttestCredential from "./attestation/AttestCredential";
import ModelReceipts from "./attestation/ModelReceipts";

type Phase =
  | "idle"
  | "connecting"
  | "creating_session"
  | "preparing"
  | "waiting"
  | "signing"
  | "submitting"
  | "reading"
  | "done"
  | "error";
interface ErrorState {
  title: string;
  detail: string;
}
interface PrepareMetaState {
  submissionMode: string;
  submissionDetail: string;
}
interface QueueState {
  jobId: string;
  status: string;
}

// The full on-chain path, presented as a calm credential reveal rather than a
// dashboard: connect Freighter -> attestor co-signs -> wallet signs + submits ->
// read the ZK-verified attestation back from the contract -> present the card.
export default function OnChainAttest({
  walletAddress,
  onWalletConnected,
}: {
  walletAddress?: string | null;
  onWalletConnected?: (address: string) => void;
}) {
  const [wallet, setWallet] = useState<string | null>(walletAddress ?? null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<ErrorState | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [attestation, setAttestation] = useState<AttestationData | null>(null);
  const [prepared, setPrepared] = useState<PreparedAttestation | null>(null);
  const [prepareMeta, setPrepareMeta] = useState<PrepareMetaState | null>(null);
  const [queueState, setQueueState] = useState<QueueState | null>(null);
  const [resultIn, setResultIn] = useState(false);

  useEffect(() => {
    if (walletAddress) setWallet((w) => w ?? walletAddress);
  }, [walletAddress]);

  useEffect(() => {
    getConnectedAddress()
      .then((a) => a && setWallet((w) => w ?? a))
      .catch(() => undefined);
  }, []);

  // Play the credential's rise-in transition one frame after it mounts.
  useEffect(() => {
    if (phase !== "done") {
      setResultIn(false);
      return;
    }
    const id = requestAnimationFrame(() => setResultIn(true));
    return () => cancelAnimationFrame(id);
  }, [phase]);

  async function connect() {
    setError(null);
    setPhase("connecting");
    try {
      const addr = await connectFreighter();
      setWallet(addr);
      onWalletConnected?.(addr);
      setPhase("idle");
    } catch (e) {
      setError(describeError(e));
      setPhase("error");
    }
  }

  async function attest() {
    if (!wallet) return;
    setError(null);
    setTxHash(null);
    setAttestation(null);
    setPrepared(null);
    setPrepareMeta(null);
    setQueueState(null);
    try {
      // 1. attestor scores + signs its authorization entry (server-side key).
      setPhase("creating_session");
      setPhase("preparing");
      const result = await prepareAttestation(wallet, handlePreparePhase);
      setPrepareMeta({
        submissionMode: result.submission_mode,
        submissionDetail: result.submission_detail,
      });
      await completePreparedAttestation(wallet, result);
    } catch (e) {
      setError(describeError(e));
      setPhase("error");
    }
  }

  function handlePreparePhase(_phase: "queued" | "proving", meta: AttestationPreparePhaseMeta) {
    setPrepareMeta({
      submissionMode: meta.submissionMode,
      submissionDetail: meta.submissionDetail,
    });
    setQueueState({ jobId: meta.jobId, status: meta.status });
    setPhase("waiting");
  }

  async function completePreparedAttestation(
    currentWallet: string,
    result: PreparedAttestation,
  ) {
    const { submitCosignedAttestation, getAttestation } = await import("../lib/contracts");

    // 2. wallet signs the envelope (Freighter) and submits.
    setPhase("signing");
    setPhase("submitting");
    const hash = await submitCosignedAttestation(result.partial_xdr, currentWallet);
    setTxHash(hash);
    // 3. read the ZK-verified attestation back from the contract.
    setPhase("reading");
    const att = await getAttestation(currentWallet);
    setPrepared(result);
    setAttestation(att);
    setQueueState(null);
    setPhase("done");
  }

  const busy =
    phase === "connecting" ||
    phase === "creating_session" ||
    phase === "preparing" ||
    phase === "waiting" ||
    phase === "signing" ||
    phase === "submitting" ||
    phase === "reading";

  const stepper = stepperState(phase);
  const mode = modeFor(prepareMeta);

  return (
    <div className="mt-12 w-full">
      {/* Connect / wallet */}
      <div className="surface flex flex-wrap items-center justify-between gap-5 p-6">
        <div className="flex flex-col gap-1.5">
          <span className="font-display text-lg font-medium text-fog">
            {wallet ? "Wallet connected" : "Connect Freighter to begin"}
          </span>
          <span className="text-sm text-fog-muted">
            {wallet
              ? "Ready to issue an attestation for this address"
              : "A one-time signature proves you control the wallet, no keys are shared"}
          </span>
        </div>
        {wallet ? (
          <span className="inline-flex items-center gap-3 rounded-xl border border-[rgba(233,206,158,0.18)] bg-[rgba(233,206,158,0.04)] px-4 py-2.5 font-mono text-[0.82rem] text-fog">
            <span className="h-[26px] w-[26px] rounded-full [background:conic-gradient(from_210deg,#7FEBD9,#FAD1FF,#E9CE9E,#7FEBD9)]" />
            <span className="truncate">
              {wallet.slice(0, 4)}…{wallet.slice(-4)}
            </span>
            <span className="inline-flex items-center gap-1.5 text-teal-bright">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-bright opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-teal-bright" />
              </span>
              <span className="drop-shadow-[0_0_8px_rgba(127,235,217,0.85)]">Mainnet</span>
            </span>
          </span>
        ) : (
          <button
            onClick={connect}
            disabled={phase === "connecting"}
            className="btn-primary !py-3 text-xs disabled:opacity-60"
          >
            {phase === "connecting" ? "Connecting…" : "Connect Freighter"}
          </button>
        )}
      </div>

      {wallet && (
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          {["Freighter detected", "Unlocked", "Network: Mainnet"].map((h) => (
            <span key={h} className="inline-flex items-center gap-2 font-mono text-[0.82rem] text-fog-faint">
              <span className="text-teal-bright">✓</span> {h}
            </span>
          ))}
        </div>
      )}

      {/* Action + reveal sequence */}
      {wallet && (
        <div className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-fog-faint">
                The process
              </p>
              <h2 className="mt-3 font-display text-2xl font-medium tracking-[-0.015em] text-fog md:text-3xl">
                Four steps, then a credential
              </h2>
            </div>
            <button
              onClick={attest}
              disabled={busy}
              className="btn-ghost !py-3 text-xs disabled:opacity-60"
            >
              {requestLabel(phase)}
            </button>
          </div>

          {/* Steps are always visible once connected — dimmed at rest, then they
              light up one by one as the backend advances through each phase. */}
          <div className="mt-8">
            <RevealStepper
              activeIndex={stepper.activeIndex}
              allDone={phase === "done"}
              mode={mode}
              queue={queueState}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {phase === "error" && error && (
        <div className="mt-8 rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-5 text-sm text-red-300">
          <p className="font-display font-medium text-red-200">{error.title}</p>
          <p className="mt-1.5 text-red-300/90">{error.detail}</p>
        </div>
      )}

      {/* Credential + receipts */}
      {phase === "done" && attestation && (
        <div className="mt-9">
          <AttestCredential
            creditScore={prepared?.credit_score}
            riskBucket={attestation.riskBucket}
            riskBucketName={prepared?.risk_bucket_name}
            confidenceBps={attestation.confidence}
            zkVerified={attestation.zkVerified}
            proofHash={attestation.proofOrHash}
            attestor={attestation.attestor}
            fullModelHash={attestation.fullModelHash}
            distilledModelHash={attestation.distilledModelHash}
            issuedAt={attestation.issuedAt}
            expiresAt={attestation.expiresAt}
            txHash={txHash}
            inView={resultIn}
          />
          <ModelReceipts topFeatures={prepared?.top_features} inView={resultIn} />
        </div>
      )}
    </div>
  );
}

function stepperState(phase: Phase): { show: boolean; activeIndex: number | null } {
  switch (phase) {
    case "creating_session":
    case "preparing":
      return { show: true, activeIndex: 0 };
    case "waiting":
      return { show: true, activeIndex: 1 };
    case "signing":
    case "submitting":
      return { show: true, activeIndex: 2 };
    case "reading":
      return { show: true, activeIndex: 3 };
    case "done":
      return { show: true, activeIndex: null };
    default:
      return { show: false, activeIndex: null };
  }
}

function requestLabel(phase: Phase): string {
  switch (phase) {
    case "creating_session":
      return "Creating session…";
    case "preparing":
      return "Preparing…";
    case "waiting":
      return "Queued for proving…";
    case "signing":
      return "Waiting for Freighter…";
    case "submitting":
      return "Submitting to Soroban…";
    case "reading":
      return "Reading on-chain result…";
    case "done":
      return "Attested ✓";
    default:
      return "Request attestation";
  }
}

function modeFor(meta: PrepareMetaState | null): StepperMode | null {
  if (!meta) return null;
  switch (meta.submissionMode) {
    case "live_cosign":
      return {
        title: "Live proof",
        detail:
          "Wallet-specific proof prepared for this request, not cached or fixture-backed",
        tone: "live",
      };
    case "demo_fixture_cosign":
      return {
        title: "Demo fixture proof",
        detail:
          "Prepared from the committed demo fixture, this demonstrates the on-chain verify path, not a fresh wallet-specific proof",
        tone: "fixture",
      };
    default:
      return { title: meta.submissionMode, detail: meta.submissionDetail, tone: "other" };
  }
}

function describeError(error: unknown): ErrorState {
  if (error instanceof FreighterError) {
    switch (error.kind) {
      case "extension_missing":
        return {
          title: "Freighter not detected",
          detail:
            "Install the Freighter browser extension, unlock it, and reload the page before connecting this wallet.",
        };
      case "authorization_failed":
        return {
          title: "Wallet access not approved",
          detail:
            "Freighter did not grant this site access to the selected Stellar wallet. Approve the connection and try again.",
        };
      case "address_unavailable":
        return {
          title: "Wallet address unavailable",
          detail:
            "Freighter connected, but it did not return a usable Stellar address. Unlock the extension and confirm the active account.",
        };
      case "wrong_network":
        return {
          title: "Wrong Freighter network",
          detail:
            "Freighter is not on Stellar Mainnet. Switch the extension to Mainnet, then retry the wallet action.",
        };
      case "sign_rejected":
        return {
          title: "Transaction not signed",
          detail:
            "The attestation transaction was not signed in Freighter. Approve the signature request to continue.",
        };
      default:
        return {
          title: "Wallet action failed",
          detail: error.message,
        };
    }
  }

  if (error instanceof ContractRpcError) {
    switch (error.kind) {
      case "source_account_unavailable":
        return {
          title: "Wallet not ready for mainnet submission",
          detail:
            "This Stellar mainnet wallet is missing or underfunded for transaction fees. Fund it on mainnet, then retry the attestation.",
        };
      case "submit_timeout":
        return {
          title: "Transaction confirmation timed out",
          detail:
            "The transaction was submitted, but the app did not see confirmation in time. Check the wallet activity and retry only if nothing landed on-chain.",
        };
      case "chain_failed":
        return {
          title: "Transaction failed on-chain",
          detail:
            "Soroban accepted the submission attempt, but the transaction did not succeed on-chain. Check contract state and retry with a fresh attestation request.",
        };
      default:
        return {
          title: "Transaction submission failed",
          detail: error.message,
        };
    }
  }

  if (error instanceof AttestationPrepareError) {
    switch (error.kind) {
      case "api_unreachable":
        return {
          title: "Backend unavailable",
          detail:
            "Wallet connection is working, but the ZKredit backend could not be reached from this browser.",
        };
      case "session_failed":
        return {
          title: "Session setup failed",
          detail:
            "The backend could not create or validate the wallet session needed for attestation preparation.",
        };
      case "rate_limited":
        return {
          title: "Attestation temporarily rate-limited",
          detail:
            "This wallet or browser has reached the current attestation limit. Wait and try again later.",
        };
      case "already_attested":
        return {
          title: "Wallet already attested",
          detail:
            "This wallet already has an on-chain attestation in the current contract flow. Use a fresh wallet or wait for the re-attestation path.",
        };
      case "prepare_unavailable":
        return {
          title: "Live proof preparation unavailable",
          detail:
            "The backend is reachable, but it cannot prepare a wallet-specific RISC Zero co-sign transaction in this environment right now.",
        };
      case "job_status_unavailable":
        return {
          title: "Queued proving is not available yet",
          detail:
            "The backend accepted the attestation request as a queued job, but this deployment does not expose the job-status API needed to continue from the browser.",
        };
      case "job_failed":
        return {
          title: "Queued proving failed",
          detail:
            "The backend reported that the proving job did not complete successfully. Check the attestor worker logs and retry the request.",
        };
      default:
        return {
          title: "Attestation preparation failed",
          detail: error.message,
        };
    }
  }

  if (error instanceof Error) {
    return {
      title: "Attestation failed",
      detail: error.message,
    };
  }

  return {
    title: "Attestation failed",
    detail: String(error),
  };
}
