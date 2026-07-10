import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  getAttestationRecord,
  getModelInfo,
  getWalletFeatures,
  isValidStellarAddress,
  type AttestationRecordResponse,
  type AttestationResponse,
  type FeatureSummaryResponse,
  type ModelInfoResponse,
} from "../lib/api";
import {
  AttestationPrepareError,
  prepareAttestation,
  type PreparedAttestation,
} from "../lib/attestor";
import { getConnectedAddress } from "../lib/freighter";

const BUCKETS = ["VERY_LOW", "LOW", "MEDIUM", "HIGH", "VERY_HIGH"] as const;

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

export default function TryAttestation({
  walletAddress,
  onWalletConnected,
}: {
  walletAddress?: string | null;
  onWalletConnected?: (address: string) => void;
}) {
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

  // Freighter may already be approved for this origin from a prior session —
  // pick it up silently without prompting, and let the nav button know too.
  useEffect(() => {
    getConnectedAddress()
      .then((connected) => {
        if (connected) {
          setAddress((current) => current || connected);
          onWalletConnected?.(connected);
        }
      })
      .catch(() => {
        // Freighter is optional. Keep manual entry available.
      });
  }, []);

  // Connecting via the nav button fills this field even if it happens after mount.
  useEffect(() => {
    if (walletAddress) setAddress((current) => current || walletAddress);
  }, [walletAddress]);

  useEffect(() => () => {
    if (stepTimer.current) clearInterval(stepTimer.current);
  }, []);

  useEffect(() => {
    void getModelInfo()
      .then(setModelInfo)
      .catch(() => setModelInfo(null));
  }, []);

  async function runAttestation(addr: string) {
    setPhase("loading");
    setStep(0);
    setErrorMessage("");
    setAttestation(null);
    setRecord(null);
    setFeatures(null);
    setFeaturesUnavailable(false);
    setModelInfo(null);

    stepTimer.current = setInterval(() => {
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }, 900);

    try {
      const result = await prepareAttestation(addr, (nextPhase) => {
        if (nextPhase === "queued") setStep(3);
        if (nextPhase === "proving") setStep(3);
      });
      setAttestation(toAttestationResponse(result));

      const [recordRes, featuresRes, modelInfoRes] = await Promise.allSettled([
        getAttestationRecord(addr),
        getWalletFeatures(addr),
        getModelInfo(),
      ]);
      if (recordRes.status === "fulfilled") setRecord(recordRes.value);
      if (featuresRes.status === "fulfilled") {
        setFeatures(featuresRes.value);
      } else {
        setFeaturesUnavailable(true);
      }
      if (modelInfoRes.status === "fulfilled") {
        setModelInfo(modelInfoRes.value);
      }

      setPhase("done");
    } catch (err) {
      const message =
        err instanceof AttestationPrepareError
          ? err.kind === "api_unreachable"
            ? "Could not reach the attestation service. It may be offline - please retry in a moment."
            : err.message
          : "Something went wrong generating this attestation.";
      setErrorMessage(message);
      setPhase("error");
    } finally {
      if (stepTimer.current) clearInterval(stepTimer.current);
      setStep(STEPS.length - 1);
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
    <div id="attestation" className="mt-14 flex flex-col items-center">
      <form onSubmit={onSubmit} className="flex w-full max-w-3xl items-center gap-2">
        <div className="card-shine relative min-w-0 flex-1 rounded-xl">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="G..."
            spellCheck={false}
            className="relative z-10 h-11 w-full min-w-0 rounded-xl border border-white/10 bg-ink-900/60 px-4 font-mono text-sm text-fog outline-none placeholder:text-fog-faint"
          />
        </div>

        <button
          type="submit"
          disabled={phase === "loading"}
          className="btn-primary shrink-0 justify-center whitespace-nowrap !py-2.5 text-xs disabled:opacity-50"
        >
          {phase === "loading" ? "Working…" : "Request attestation"}
        </button>
      </form>

      <div className="mt-12 w-full text-left">
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
  );
}

function toAttestationResponse(result: PreparedAttestation): AttestationResponse {
  return {
    stellar_address: result.stellar_address ?? "",
    risk_bucket: result.risk_bucket,
    risk_bucket_name: result.risk_bucket_name ?? "UNKNOWN",
    confidence: result.confidence,
    credit_score: result.credit_score ?? 0,
    full_model_hash: result.full_model_hash ?? "",
    distilled_model_hash: result.distilled_model_hash,
    zk_verified: result.zk_verified ?? false,
    proof_generated: result.proof_generated ?? false,
    proof_hash: result.proof_hash ?? "",
    public_inputs: result.public_inputs ?? [],
    anomaly: result.anomaly ?? false,
    anomaly_score: result.anomaly_score ?? 0,
    top_features: result.top_features ?? [],
    reason_codes: result.reason_codes ?? [],
    feature_schema_version: result.feature_schema_version ?? "v1",
    tx_hash: null,
    created_at: result.created_at ?? new Date().toISOString(),
  };
}

function LoadingSteps({ step }: { step: number }) {
  return (
    <div className="surface mx-auto max-w-xl p-6">
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
    <div className="surface mx-auto flex max-w-xl flex-col items-start gap-3 border-red-500/30 p-6">
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
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <SummaryCard attestation={attestation} />

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-6">
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
        </div>

        <div className="flex flex-col gap-6">
          <Section title="Feature summary">
            {featuresUnavailable && (
              <p className="text-sm text-fog-muted">Feature summary unavailable for this wallet.</p>
            )}
            {features && (
              <div className="grid grid-cols-2 gap-4">
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
              {record?.submission_detail && <Row k="Submission detail" v={record.submission_detail} />}
            </dl>
          </Section>
        </div>
      </div>

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

function SummaryCard({ attestation }: { attestation: AttestationResponse }) {
  const color = RISK_COLORS[attestation.risk_bucket_name] ?? "#888";

  return (
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
            attestation.zk_verified ? "bg-teal-bright/15 text-teal-bright" : "bg-white/10 text-fog-muted"
          }`}
        >
          {attestation.zk_verified ? "ZK-verified on-chain" : "not verified on-chain"}
        </span>
      </div>
      <p className="mt-4 truncate font-mono text-xs text-fog-faint">{attestation.stellar_address}</p>

      <RiskGauge bucket={attestation.risk_bucket} />
    </div>
  );
}

function RiskGauge({ bucket }: { bucket: number }) {
  const markerLeft = `${(bucket + 0.5) * (100 / BUCKETS.length)}%`;

  return (
    <div className="mt-7">
      <div className="relative h-6">
        <div
          className="absolute -top-1 -translate-x-1/2 border-x-[6px] border-t-[7px] border-x-transparent transition-[left] duration-700 ease-smooth"
          style={{ left: markerLeft, borderTopColor: RISK_COLORS[BUCKETS[bucket]] }}
        />
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full">
        {BUCKETS.map((b, i) => (
          <div
            key={b}
            className="flex-1 transition-opacity duration-500"
            style={{ background: RISK_COLORS[b], opacity: i === bucket ? 1 : 0.25 }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-wide text-fog-faint">
        <span>Very low risk</span>
        <span>Very high risk</span>
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
