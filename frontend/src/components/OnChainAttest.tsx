import { useEffect, useState } from "react";
import { connectFreighter, getConnectedAddress } from "../lib/freighter";
import { prepareAttestation } from "../lib/attestor";
import {
  getAttestation,
  submitCosignedAttestation,
  type AttestationData,
} from "../lib/contracts";
import { getLoanTerms } from "../lib/contracts/mock-lending-pool";
import type { LoanOffer } from "../lib/contracts/types";
import { RISK_BUCKET_COLORS, RISK_BUCKET_LABELS } from "../lib/contracts/types";

type Phase = "idle" | "connecting" | "attesting" | "reading" | "done" | "error";

// The full on-chain path, exactly as the demo narrates it:
//   connect Freighter -> attestor co-signs -> wallet signs + submits ->
//   read the ZK-verified attestation back from the contract -> show loan terms.
export default function OnChainAttest({
  walletAddress,
  onWalletConnected,
}: {
  walletAddress?: string | null;
  onWalletConnected?: (address: string) => void;
}) {
  const [wallet, setWallet] = useState<string | null>(walletAddress ?? null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [attestation, setAttestation] = useState<AttestationData | null>(null);
  const [loan, setLoan] = useState<LoanOffer | null>(null);

  useEffect(() => {
    if (walletAddress) setWallet((w) => w ?? walletAddress);
  }, [walletAddress]);

  useEffect(() => {
    getConnectedAddress()
      .then((a) => a && setWallet((w) => w ?? a))
      .catch(() => {});
  }, []);

  async function connect() {
    setError("");
    setPhase("connecting");
    try {
      const addr = await connectFreighter();
      setWallet(addr);
      onWalletConnected?.(addr);
      setPhase("idle");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setPhase("error");
    }
  }

  async function attest() {
    if (!wallet) return;
    setError("");
    setTxHash(null);
    setAttestation(null);
    setLoan(null);
    setPhase("attesting");
    try {
      // 1. attestor scores + signs its authorization entry (server-side key).
      const prepared = await prepareAttestation(wallet);
      // 2. wallet signs the envelope (Freighter) and submits.
      const hash = await submitCosignedAttestation(prepared.partial_xdr, wallet);
      setTxHash(hash);
      // 3. read the ZK-verified attestation back from the contract, and the
      //    loan terms it now unlocks.
      setPhase("reading");
      const [att, terms] = await Promise.all([
        getAttestation(wallet),
        getLoanTerms(wallet).catch(() => null),
      ]);
      setAttestation(att);
      setLoan(terms);
      setPhase("done");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setPhase("error");
    }
  }

  const busy = phase === "attesting" || phase === "reading" || phase === "connecting";

  return (
    <div className="surface mx-auto mt-10 w-full max-w-2xl p-6 md:p-8">
      <p className="mb-1 font-mono text-xs uppercase tracking-[0.2em] text-fog-faint">
        On-chain attestation (live testnet)
      </p>
      <p className="mb-5 text-sm text-fog-muted">
        Connect Freighter, then produce a real ZK-verified attestation: the
        attestor co-signs, your wallet signs, and the contract verifies the
        Groth16 receipt on-chain.
      </p>

      {!wallet ? (
        <button onClick={connect} disabled={busy} className="btn-primary !py-2.5 text-xs disabled:opacity-50">
          {phase === "connecting" ? "Connecting…" : "Connect Freighter"}
        </button>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="truncate font-mono text-xs text-fog-faint">{wallet}</p>
          <button onClick={attest} disabled={busy} className="btn-primary !py-2.5 text-xs disabled:opacity-50">
            {phase === "attesting"
              ? "Attesting (sign in Freighter)…"
              : phase === "reading"
                ? "Reading on-chain result…"
                : "Attest on-chain"}
          </button>
        </div>
      )}

      {phase === "error" && (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/[0.06] p-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {attestation && phase === "done" && (
        <div className="mt-6 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="rounded-full px-3 py-1 font-display text-sm font-semibold text-ink-900"
              style={{ background: RISK_BUCKET_COLORS[attestation.riskBucket] }}
            >
              {RISK_BUCKET_LABELS[attestation.riskBucket].replace("_", " ")}
            </span>
            <span className="font-mono text-sm text-fog-muted tabular">
              {(attestation.confidence / 100).toFixed(2)}% confidence
            </span>
            <span
              className={`rounded-full px-3 py-1 text-xs ${
                attestation.zkVerified
                  ? "bg-teal-bright/15 text-teal-bright"
                  : "bg-white/10 text-fog-muted"
              }`}
            >
              {attestation.zkVerified ? "ZK-verified on-chain ✓" : "not verified"}
            </span>
          </div>

          {loan && (
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm text-fog-muted">
              <p className="mb-1 font-mono text-xs uppercase tracking-wide text-fog-faint">
                Loan terms unlocked
              </p>
              APR {(loan.aprBasisPoints / 100).toFixed(1)}% · collateral{" "}
              {(loan.collateralRatioBasisPoints / 100).toFixed(0)}% · max{" "}
              {loan.maxPrincipal.toString()}
            </div>
          )}

          {txHash && (
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-teal-bright underline break-all"
            >
              view transaction ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
