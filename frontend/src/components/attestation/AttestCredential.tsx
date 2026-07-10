import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { RISK_BUCKET_COLORS, RISK_BUCKET_LABELS } from "../../lib/contracts/types";
import { NETWORK } from "../../lib/contracts/config";

// The centrepiece: a private-bank "metal card" that presents the finished
// attestation as a credential rather than a dashboard readout. Everything on
// it is real: the score and top features ride in on the prepare response, and
// the proof hash / attestor / model hashes / expiry are read back from the
// Soroban contract. Click (or press) the card to turn it and read the engraved
// on-chain provenance; the cursor signals that it is turnable.

function short(addr: string, head = 4, tail = 4): string {
  if (!addr) return "-";
  return addr.length <= head + tail + 1 ? addr : `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

function daysUntil(expiresAt: bigint): number | null {
  const ms = Number(expiresAt) * 1000 - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 86_400_000));
}

function isoDate(unixSeconds: bigint): string {
  const ms = Number(unixSeconds) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  return new Date(ms).toISOString().slice(0, 10);
}

const STELLAR_EXPERT_NETWORK = NETWORK.passphrase.startsWith("Public Global Stellar Network")
  ? "public"
  : "testnet";

export default function AttestCredential({
  creditScore,
  riskBucket,
  riskBucketName,
  confidenceBps,
  zkVerified,
  proofHash,
  attestor,
  fullModelHash,
  distilledModelHash,
  issuedAt,
  expiresAt,
  txHash,
  inView,
}: {
  creditScore?: number;
  riskBucket: number;
  riskBucketName?: string;
  confidenceBps: number;
  zkVerified: boolean;
  proofHash: string;
  attestor: string;
  fullModelHash: string;
  distilledModelHash: string;
  issuedAt: bigint;
  expiresAt: bigint;
  txHash: string | null;
  inView: boolean;
}) {
  const bucketColor = RISK_BUCKET_COLORS[riskBucket] ?? "#7FEBD9";
  const bucketName = (riskBucketName ?? RISK_BUCKET_LABELS[riskBucket] ?? "UNKNOWN").replace(/_/g, " ");
  const confidence = (confidenceBps / 10000).toFixed(2);
  const days = daysUntil(expiresAt);
  const [flipped, setFlipped] = useState(false);
  const specRef = useRef<HTMLSpanElement>(null);

  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    const spec = specRef.current;
    if (!spec) return;
    const r = e.currentTarget.getBoundingClientRect();
    spec.style.left = `${((e.clientX - r.left) / r.width) * 100 - 20}%`;
  }

  function onKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setFlipped((f) => !f);
    }
  }

  const explorer =
    txHash ? (
      <a
        href={`https://stellar.expert/explorer/${STELLAR_EXPERT_NETWORK}/tx/${txHash}`}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-teal-bright underline decoration-teal-bright/40 underline-offset-2"
      >
        view on Stellar Expert ↗
      </a>
    ) : (
      "-"
    );

  return (
    <div className={`reveal-rise ${inView ? "is-in" : ""}`}>
      <div className="[perspective:1800px]">
        <div
          role="button"
          tabIndex={0}
          aria-pressed={flipped}
          aria-label="Turn card to view on-chain provenance"
          onClick={() => setFlipped((f) => !f)}
          onKeyDown={onKey}
          className="group relative cursor-pointer transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] [transform-style:preserve-3d] focus:outline-none motion-reduce:transition-none"
          style={{ transform: flipped ? "rotateY(180deg)" : "none" }}
        >
          {/* ── FRONT ─────────────────────────────────────────────── */}
          <div className="[backface-visibility:hidden]">
            <div className="metal-frame transition-shadow duration-300 group-hover:shadow-[0_46px_100px_-44px_rgba(0,0,0,0.95),0_0_78px_-28px_rgba(233,206,158,0.4)] group-focus-visible:shadow-[0_0_0_2px_rgba(127,235,217,0.6)]">
              <div className="metal-card p-7 md:p-9" onPointerMove={onMove}>
                <span ref={specRef} className="metal-spec" aria-hidden />

                <div className="relative z-[2] flex items-start justify-between gap-5">
                  <div className="font-display text-[0.82rem] font-semibold tracking-[0.2em] text-[#f6e7c4]">
                    ZKREDIT
                    <span className="mt-1 block font-mono text-[9.5px] font-normal uppercase tracking-[0.16em] text-fog-faint">
                      Risk Attestation · v1
                    </span>
                  </div>
                  <VerificationSeal zkVerified={zkVerified} />
                </div>

                <div className="relative z-[2] mt-7 flex flex-wrap items-end justify-between gap-6">
                  <div className="flex items-end gap-5">
                    <div className="metal-chip h-[38px] w-[52px] shrink-0" aria-hidden />
                    <div className="flex flex-col">
                      {creditScore != null ? (
                        <>
                          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-fog-faint">
                            Credit score · off-chain, display only
                          </span>
                          <span className="metal-emboss font-display text-[3.6rem] font-medium leading-[0.9] tracking-[-0.02em] text-[#f6e7c4] md:text-[4.4rem]">
                            {creditScore}
                            <span className="ml-2 text-base tracking-normal text-fog-faint">/ 850</span>
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-fog-faint">
                            Risk standing
                          </span>
                          <span className="metal-emboss font-display text-[2.6rem] font-medium leading-[0.95] tracking-[-0.01em] text-[#f6e7c4] md:text-[3.2rem]">
                            {bucketName}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-3.5">
                    <span
                      className="rounded-full px-4 py-2 font-display text-[0.9rem] font-semibold tracking-[0.03em] text-ink-900"
                      style={{ background: bucketColor, boxShadow: `0 0 26px -6px ${bucketColor}` }}
                    >
                      {bucketName}
                    </span>
                    <span className="text-right font-mono text-[0.82rem] text-fog-muted">
                      confidence
                      <br />
                      <b className="text-[1.05rem] font-normal text-fog tabular">{confidence}</b>
                    </span>
                  </div>
                </div>

                <div className="relative z-[2] mt-8 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-[rgba(233,206,158,0.16)] pt-5 sm:grid-cols-4">
                  <Field k="Proof hash" v={short(proofHash, 6, 4)} />
                  <Field k="Attestor" v={short(attestor)} />
                  <Field k="Expires" v={days == null ? "-" : `in ${days} days`} />
                  <Field k="On-chain" v={explorer} />
                </div>
              </div>
            </div>
          </div>

          {/* ── BACK ──────────────────────────────────────────────── */}
          <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <div className="metal-frame h-full">
              <div className="metal-card flex h-full flex-col p-7 md:p-9">
                <div className="relative z-[2] flex items-start justify-between gap-5">
                  <div className="font-display text-[0.82rem] font-semibold tracking-[0.2em] text-[#f6e7c4]">
                    ZKREDIT
                    <span className="mt-1 block font-mono text-[9.5px] font-normal uppercase tracking-[0.16em] text-fog-faint">
                      Anchored on Soroban
                    </span>
                  </div>
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-fog-faint">
                    Issued {isoDate(issuedAt)}
                  </span>
                </div>

                {/* magnetic-stripe motif */}
                <div
                  aria-hidden
                  className="relative z-[2] mt-5 h-9 w-[calc(100%+3.5rem)] -translate-x-7 bg-black/55 md:-translate-x-9"
                  style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(255,255,255,0.04)" }}
                />

                <div className="relative z-[2] mt-6">
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-fog-faint">
                    Distilled model · ZK target
                  </div>
                  <div className="metal-emboss mt-2 break-all font-mono text-[0.95rem] leading-relaxed text-[#f6e7c4]">
                    {distilledModelHash || "-"}
                  </div>
                </div>

                <div className="relative z-[2] mt-5 border-t border-[rgba(233,206,158,0.16)] pt-5">
                  <Field k="Full model hash" v={short(fullModelHash, 8, 6)} />
                </div>

                <p className="relative z-[2] mt-auto pt-5 font-mono text-[0.78rem] leading-relaxed text-fog-faint">
                  Hashes anchored on-chain, full scoring model runs off-chain, only the distilled model
                  is proven
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-fog-faint">{k}</div>
      <div className="mt-1.5 break-all font-mono text-[12.5px] text-fog-muted">{v}</div>
    </div>
  );
}

// Canvas-engraved medallion: a guilloché spirograph (the security-print motif
// on banknotes and share certificates) ringed in champagne, with a teal check
// when the receipt was verified on-chain, or a muted mark when hash-anchored.
function VerificationSeal({ zkVerified }: { zkVerified: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const w = cv.width;
    const h = cv.height;
    const cx = w / 2;
    const cy = h / 2;
    ctx.clearRect(0, 0, w, h);

    const ring = ctx.createLinearGradient(0, 0, w, h);
    ring.addColorStop(0, "#f6e7c4");
    ring.addColorStop(0.5, "#c6a667");
    ring.addColorStop(1, zkVerified ? "#7FEBD9" : "#c6a667");
    ctx.strokeStyle = ring;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 58, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 50, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(233,206,158,0.5)";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    const R = 40;
    const r = 7;
    const d = 16;
    const k = (R - r) / r;
    for (let t = 0; t <= Math.PI * 2 * 7; t += 0.04) {
      const x = cx + (R - r) * Math.cos(t) + d * Math.cos(k * t);
      const y = cy + (R - r) * Math.sin(t) - d * Math.sin(k * t);
      if (t === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, [zkVerified]);

  return (
    <div className="relative h-16 w-16 shrink-0">
      <canvas ref={canvasRef} width={128} height={128} className="absolute inset-0 h-16 w-16" />
      <span
        className={`absolute inset-0 grid place-items-center text-[20px] ${
          zkVerified ? "text-teal-bright drop-shadow-[0_0_10px_rgba(127,235,217,0.6)]" : "text-[#e9ce9e]"
        }`}
      >
        {zkVerified ? "✓" : "⌘"}
      </span>
      <span className="absolute left-1/2 top-full mt-[7px] -translate-x-1/2 whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.18em]">
        <span className={zkVerified ? "text-teal-bright" : "text-[#e9ce9e]"}>
          {zkVerified ? "ZK-verified" : "hash-anchored"}
        </span>
      </span>
    </div>
  );
}
