import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  getAttestationRecord,
  getModelInfo,
  getWalletFeatures,
  isValidStellarAddress,
  requestAttestation,
  type AttestationRecordResponse,
  type AttestationResponse,
  type FeatureSummaryResponse,
  type ModelInfoResponse,
} from "../lib/api";
import { connectFreighter, getConnectedAddress } from "../lib/freighter";

const RISK_COLORS: Record<string, string> = {
  VERY_LOW: "#22c55e",
  LOW: "#84cc16",
  MEDIUM: "#eab308",
  HIGH: "#f97316",
  VERY_HIGH: "#ef4444",
};

const STEPS = [
  "Fetching wallet history from Horizon",
  "Extracting behavioral features",
  "Running the risk model",
  "Generating the attestation proof",
  "Submitting the attestation",
];

const FEATURE_LABELS: [key: string, label: string][] = [
  ["num_operations", "Total operations"],
  ["account_age_days", "Account age (days)"],
  ["recency_days", "Recency of activity (days)"],
  ["distinct_assets", "Distinct assets"],
  ["distinct_trustlines", "Trustlines"],
  ["distinct_send", "Distinct senders"],
  ["distinct_recv", "Distinct recipients"],
  ["failed_ratio", "Failed transaction ratio"],
  ["sent_amt", "Sent volume"],
  ["recv_amt", "Received volume"],
];

type Phase = "idle" | "loading" | "done" | "error";

export default function TryAttestation() {
  const [address, setAddress] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");

  const [attestation, setAttestation] = useState<AttestationResponse | null>(null);
  const [record, setRecord] = useState<AttestationRecordResponse | null>(null);
  const [features, setFeatures] = useState<FeatureSummaryResponse | null>(null);
  const [featuresUnavailable, setFeaturesUnavailable] = useState(false);
  const [modelInfo, setModelInfo] = useState<ModelInfoResponse | null>(null);

  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getModelInfo()
      .then(setModelInfo)
      .catch(() => setModelInfo(null));
  }, []);

  useEffect(() => {
    getConnectedAddress()
      .then((connected) => {
        if (connected) setAddress((current) => current || connected);
      })
      .catch(() => {
        // Freighter is optional. Keep manual entry available.
      });
  }, []);

  useEffect(() => () => {
    if (stepTimer.current) clearInterval(stepTimer.current);
  }, []);

  async function runAttestation(addr: string) {
    setPhase("loading");
    setStep(0);
    setErrorMessage("");
    setAttestation(null);
    setRecord(null);
    setFeatures(null);
    setFeaturesUnavailable(false);

    stepTimer.current = setInterval(() => {
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }, 900);

    try {
      const result = await requestAttestation(addr);
      setAttestation(result);

      const [recordRes, featuresRes] = await Promise.allSettled([
        getAttestationRecord(addr),
        getWalletFeatures(addr),
      ]);
      if (recordRes.status === "fulfilled") setRecord(recordRes.value);
      if (featuresRes.status === "fulfilled") {
        setFeatures(featuresRes.value);
      } else {
        setFeaturesUnavailable(true);
      }

      setPhase("done");
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.status === 0
            ? "Could not reach the attestation service. It may be offline — please retry in a moment."
            : err.message
          : "Something went wrong generating this attestation.";
      setErrorMessage(message);
      setPhase("error");
    } finally {
      if (stepTimer.current) clearInterval(stepTimer.current);
      setStep(STEPS.length - 1);
    }
  }

  async function onConnectWallet() {
    setPhase("idle");
    setErrorMessage("");
    try {
      const connected = await connectFreighter();
      setAddress(connected);
    } catch (err) {
      setPhase("error");
      setErrorMessage(err instanceof Error ? err.message : "Could not connect Freighter.");
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const addr = address.trim();
    if (!isValidStellarAddress(addr)) {
      setPhase("error");
      setErrorMessage("That doesn't look like a valid Stellar address (should start with G, 56 characters).");
      return;
    }
    void runAttestation(addr);
  }

  return (
    <section id="attestation" className="relative py-28 md:py-40">
      <div className="glow left-1/2 top-1/2 h-[54vmin] w-[80vmin] -translate-x-1/2 -translate-y-1/2 animate-pulseglow" />
      <div className="absolute inset-0 bg-dotgrid opacity-30" />

      <div className="container-page relative z-10 flex flex-col items-center text-center">
        <p className="eyebrow mb-4">
          <span className="h-1.5 w-1.5 rounded-full accent-dot" />
          Attestation
        </p>
        <h2 className="max-w-3xl font-display text-display-md font-semibold text-fog">
          Give your wallet a <span className="text-gradient">credit identity</span> it can prove.
        </h2>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-fog-muted">
          Enter a Stellar address to run the full pipeline: ingestion, scoring,
          proof generation, and attestation.
        </p>

        <form
          onSubmit={onSubmit}
          className="glass mt-10 flex w-full max-w-xl flex-col gap-3 rounded-2xl p-4 sm:flex-row"
        >
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="G... (Stellar public key)"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-sm text-fog outline-none placeholder:text-fog-faint focus:border-teal-bright/60"
          />
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void onConnectWallet()}
              className="btn-ghost justify-center whitespace-nowrap !px-5 !py-3"
            >
              Connect Freighter
            </button>
            <button
              type="submit"
              disabled={phase === "loading"}
              className="btn-primary justify-center whitespace-nowrap disabled:opacity-50"
            >
              {phase === "loading" ? "Working…" : "Request attestation"}
            </button>
          </div>
        </form>

        <div className="mt-10 w-full max-w-3xl text-left">
          {phase === "loading" && <LoadingSteps step={step} />}
          {phase === "error" && (
            <ErrorPanel message={errorMessage} onRetry={() => void runAttestation(address.trim())} />
          )}
          {phase === "done" && attestation && (
            <Results
              attestation={attestation}
              record={record}
              features={features}
              featuresUnavailable={featuresUnavailable}
              modelInfo={modelInfo}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function LoadingSteps({ step }: { step: number }) {
  return (
    <div className="surface p-6">
      <ul className="flex flex-col gap-3">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-3 text-sm">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                i < step ? "bg-teal-bright" : i === step ? "animate-pulse bg-teal-bright" : "bg-white/15"
              }`}
            />
            <span className={i <= step ? "text-fog" : "text-fog-faint"}>{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="surface flex flex-col items-start gap-3 border-red-500/30 p-6">
      <p className="text-sm text-red-300">{message}</p>
      <button type="button" onClick={onRetry} className="btn-ghost !py-2 text-xs">
        Retry
      </button>
    </div>
  );
}

function Results({
  attestation,
  record,
  features,
  featuresUnavailable,
  modelInfo,
}: {
  attestation: AttestationResponse;
  record: AttestationRecordResponse | null;
  features: FeatureSummaryResponse | null;
  featuresUnavailable: boolean;
  modelInfo: ModelInfoResponse | null;
}) {
  const color = RISK_COLORS[attestation.risk_bucket_name] ?? "#888";

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Attestation summary */}
      <div className="surface p-6 md:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="rounded-full px-3 py-1 font-display text-sm font-semibold text-ink-900"
            style={{ background: color }}
          >
            {attestation.risk_bucket_name.replace("_", " ")}
          </span>
          <span className="font-display text-2xl font-semibold text-fog tabular">
            {attestation.credit_score}
          </span>
          <span className="font-mono text-sm text-fog-muted tabular">
            {(attestation.confidence * 100).toFixed(1)}% confidence
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs ${
              attestation.proof_generated
                ? "bg-teal-bright/15 text-teal-bright"
                : "bg-amber-bright/15 text-amber-bright"
            }`}
          >
            {attestation.proof_generated ? "proof generated" : "hash-anchored fallback"}
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs ${
              attestation.zk_verified
                ? "bg-teal-bright/15 text-teal-bright"
                : "bg-white/10 text-fog-muted"
            }`}
          >
            {attestation.zk_verified ? "ZK-verified on-chain" : "not verified on-chain"}
          </span>
        </div>
        <p className="mt-4 truncate font-mono text-xs text-fog-faint">{attestation.stellar_address}</p>
      </div>

      {/* 2. Reason codes */}
      <Section title="Reason codes">
        {attestation.reason_codes.length === 0 ? (
          <p className="text-sm text-fog-muted">No notable risk signals for this wallet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {attestation.reason_codes.map((rc) => (
              <li
                key={rc.code}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-fog"
              >
                {rc.label}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 3. Top model features */}
      <Section title="Top model features">
        {attestation.top_features.length === 0 ? (
          <p className="text-sm text-fog-muted">No feature contributions returned.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-fog-faint">
                  <th className="pb-2 font-normal">Feature</th>
                  <th className="pb-2 font-normal">Value</th>
                  <th className="pb-2 font-normal">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {attestation.top_features.map((f) => (
                  <tr key={f.name} className="border-t border-white/[0.06]">
                    <td className="py-2 font-mono text-xs text-fog">{f.name}</td>
                    <td className="py-2 tabular text-fog-muted">{f.value.toFixed(3)}</td>
                    <td className="py-2 tabular text-fog-muted">{f.contribution.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 4. Feature summary */}
      <Section title="Feature summary">
        {featuresUnavailable && (
          <p className="text-sm text-fog-muted">Feature summary unavailable for this wallet.</p>
        )}
        {features && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {FEATURE_LABELS.filter(([key]) => key in features.summary).map(([key, label]) => (
              <div key={key}>
                <p className="text-xs uppercase tracking-wide text-fog-faint">{label}</p>
                <p className="mt-1 font-display text-lg text-fog tabular">
                  {features.summary[key].toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </p>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 5. Proof / attestation details */}
      <Section title="Proof & attestation details">
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <Row k="Proof hash" v={attestation.proof_hash} mono />
          <Row k="Transaction hash" v={record?.tx_hash ?? attestation.tx_hash ?? "pending"} mono />
          <Row k="Attestor" v={record?.attestor ?? "—"} mono />
          <Row k="Created" v={new Date(record?.created_at ?? attestation.created_at).toLocaleString()} />
          <Row
            k="Stored confidence"
            v={record ? `${(record.confidence_bps / 100).toFixed(2)}%` : "—"}
          />
          <Row k="Submission mode" v={record?.submission_mode ?? "—"} />
          <Row k="Full model hash" v={attestation.full_model_hash} mono />
          <Row k="Distilled model hash" v={attestation.distilled_model_hash} mono />
          <Row k="Feature schema" v={attestation.feature_schema_version} />
          <Row k="Feature dimension" v={modelInfo ? String(modelInfo.feature_dimension) : "—"} />
          <Row
            k="Distilled fidelity"
            v={
              modelInfo
                ? `${(modelInfo.distilled_exact_fidelity * 100).toFixed(1)}% exact, ${(
                    modelInfo.distilled_within_one_fidelity * 100
                  ).toFixed(1)}% within ±1 bucket`
                : "—"
            }
          />
          <Row k="Proving system" v={modelInfo?.proving_system ?? "—"} />
          {record?.submission_detail && (
            <Row k="Submission detail" v={record.submission_detail} />
          )}
        </dl>
      </Section>

      {/* Honesty panel */}
      <div className="surface p-6">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-fog-faint">What this actually proves</p>
        <ul className="flex flex-col gap-2 text-sm text-fog-muted">
          <li>
            <strong className="text-fog">zk_verified</strong> is true only when the distilled model's
            inference was verified on-chain — not just that a proof exists.
          </li>
          <li>
            <strong className="text-fog">proof_generated</strong> means a real proof was produced; when
            false, the attestation falls back to an on-chain hash anchor instead.
          </li>
          <li>
            <strong className="text-fog">Confidence</strong> reflects the model's certainty, not a
            repayment guarantee.
          </li>
          <li>Raw wallet data — transactions, balances, counterparties — never touches on-chain storage.</li>
          <li>The full model is hash-anchored for auditability; only the distilled model is the ZK target.</li>
        </ul>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="surface p-6">
      <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-fog-faint">{title}</p>
      {children}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-white/[0.06] pt-2">
      <dt className="font-mono text-[11px] uppercase tracking-[0.15em] text-fog-faint">{k}</dt>
      <dd className={`truncate text-sm text-fog ${mono ? "font-mono" : ""}`}>{v}</dd>
    </div>
  );
}
