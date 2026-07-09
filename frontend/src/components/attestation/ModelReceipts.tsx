import { useEffect, useState } from "react";
import { getModelInfo, type ModelInfoResponse, type TopFeature } from "../../lib/api";

// Progressive-disclosure "receipts" beneath the credential: depth on demand,
// never a dashboard. Both are real: SHAP contributions ride in on the prepare
// response, model provenance comes from GET /api/v1/model-info.

function pretty(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bApr\b/, "APR");
}

export default function ModelReceipts({
  topFeatures,
  inView,
}: {
  topFeatures?: TopFeature[];
  inView: boolean;
}) {
  const [open, setOpen] = useState<Set<number>>(() => new Set([0, 1]));
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const [model, setModel] = useState<ModelInfoResponse | null>(null);
  const [modelError, setModelError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getModelInfo()
      .then((m) => !cancelled && setModel(m))
      .catch(() => !cancelled && setModelError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const feats = (topFeatures ?? []).slice(0, 5);
  const maxAbs = Math.max(1e-6, ...feats.map((f) => Math.abs(f.contribution)));

  return (
    <div className={`reveal-rise ${inView ? "is-in" : ""} mt-6 grid items-start gap-3.5 md:grid-cols-2`}>
      {/* What the model saw */}
      <Receipt
        kicker="Receipt"
        kickerClass="text-[#e9ce9e]"
        title="What the model saw"
        isOpen={open.has(0)}
        onToggle={() => toggle(0)}
      >
        {feats.length === 0 ? (
          <p className="font-mono text-[0.82rem] text-fog-faint">
            Feature contributions were not returned with this attestation
          </p>
        ) : (
          <>
            {feats.map((f) => {
              const pos = f.contribution >= 0;
              return (
                <div key={f.name} className="mt-4 first:mt-1">
                  <div className="flex items-baseline justify-between text-[0.88rem] text-fog-muted">
                    <span>{pretty(f.name)}</span>
                    <span className={`font-mono text-[0.8rem] ${pos ? "text-teal-bright" : "text-[#F0A6A6]"}`}>
                      {pos ? "+" : "−"}
                      {Math.abs(f.contribution).toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-2 h-[7px] overflow-hidden rounded-md bg-white/5">
                    <i
                      className="block h-full rounded-md"
                      style={{
                        width: `${(Math.abs(f.contribution) / maxAbs) * 100}%`,
                        background: pos
                          ? "linear-gradient(90deg,#c6a667,#7FEBD9)"
                          : "linear-gradient(90deg,#6a3b3b,#F0A6A6)",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </>
        )}
        <p className="mt-4 font-mono text-[0.82rem] text-fog-faint">
          Top SHAP contributions, raw transaction history never leaves your side or touches the chain
        </p>
      </Receipt>

      {/* Model & proof system */}
      <Receipt
        kicker="Provenance"
        kickerClass="text-haze-pink"
        title="Model & proof system"
        isOpen={open.has(1)}
        onToggle={() => toggle(1)}
      >
        {modelError || !model ? (
          <p className="font-mono text-[0.82rem] text-fog-faint">
            {modelError ? "Model info is unavailable right now" : "Loading model info…"}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <Kv k="Full model hash" v={model.full_model_hash} />
              <Kv k="Distilled (ZK target)" v={model.distilled_model_hash} />
              <Kv k="Proof system" v={model.proving_system} />
              <Kv
                k="On-chain verify"
                v={model.zk_verified_capability ? "enabled ✓" : "hash-anchored"}
                ok={model.zk_verified_capability}
              />
            </div>
            <p className="mt-4 font-mono text-[0.82rem] text-fog-faint">
              Only the distilled model is proven, the full scoring model runs off-chain
            </p>
          </>
        )}
      </Receipt>
    </div>
  );
}

function Receipt({
  kicker,
  kickerClass,
  title,
  isOpen,
  onToggle,
  children,
}: {
  kicker: string;
  kickerClass: string;
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.012]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between px-6 py-5 text-left"
      >
        <span className="flex items-center gap-3.5">
          <span className={`font-mono text-[10.5px] uppercase tracking-[0.2em] ${kickerClass}`}>{kicker}</span>
          <span className="font-display text-[1.05rem] font-medium text-fog">{title}</span>
        </span>
        <span className="font-mono text-fog-faint transition-transform duration-300" aria-hidden>
          {isOpen ? "−" : "+"}
        </span>
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-6 pb-6 pt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Kv({ k, v, ok }: { k: string; v: string; ok?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-fog-faint">{k}</div>
      <div className={`mt-1.5 break-all font-mono text-[12.5px] ${ok ? "text-teal-bright" : "text-fog-muted"}`}>
        {v}
      </div>
    </div>
  );
}
