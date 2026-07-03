import type { CSSProperties, SVGProps } from "react";
import { motion } from "framer-motion";
import { ShieldCheck } from "./Icons";
import { ZkProof, OnChain } from "./HowVisuals";
import { fadeUp, inView, stagger } from "../lib/motion";

const CYAN = "#22E3FF";
const PURPLE = "#C4B5FD";

const PROVEN = [
  "A zero-knowledge proof, generated off-chain",
  "Nothing about the wallet is revealed",
  "Verify it yourself. No trust required",
];

const ANCHORED = [
  "The full model and its hashes go on-chain",
  "The credit score stays off-chain",
  "On-chain proof verification is on the roadmap",
];

export default function WhatsProven() {
  return (
    <section id="proven" className="relative overflow-hidden py-24 md:py-36">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-dotgrid opacity-20" />

      <div className="container-page relative z-10">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={inView}
          className="mx-auto mb-14 max-w-3xl text-center md:mb-16"
        >
          <motion.p variants={fadeUp} className="eyebrow mb-6 justify-center">
            <span className="accent-dot h-1.5 w-1.5 rounded-full" />
            What&apos;s proven
          </motion.p>
          <motion.h2
            variants={fadeUp}
            className="font-display text-4xl font-semibold leading-[1.05] text-fog md:text-6xl"
          >
            We tell you exactly what the proof covers
          </motion.h2>
          <motion.p
            variants={fadeUp}
            className="mx-auto mt-7 max-w-xl text-base leading-relaxed text-fog-muted md:text-lg"
          >
            Transparency is our foundation
          </motion.p>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={inView}
          className="grid gap-6 md:grid-cols-2"
        >
          <Card
            accent={CYAN}
            label="Proven"
            claim="Proven in zero-knowledge"
            Icon={ShieldCheck}
            points={PROVEN}
            graphic={<ZkProof />}
          />
          <Card
            accent={PURPLE}
            label="Anchored"
            claim="Anchored, and honest"
            Icon={LockChain}
            points={ANCHORED}
            graphic={<OnChain />}
          />
        </motion.div>
      </div>
    </section>
  );
}

function Card({
  accent,
  label,
  claim,
  Icon,
  points,
  graphic,
}: {
  accent: string;
  label: string;
  claim: string;
  Icon: (p: SVGProps<SVGSVGElement>) => JSX.Element;
  points: string[];
  graphic: JSX.Element;
}) {
  return (
    <motion.div
      variants={fadeUp}
      style={{ ["--edge"]: accent } as CSSProperties}
      className="card-edge group"
    >
      {/* Illumination that brightens when you hover anywhere on the card. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-25 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background: `radial-gradient(120% 95% at 50% 116%, ${accent}55 0%, ${accent}12 42%, transparent 66%)`,
        }}
      />

      <div className="relative z-10 flex min-h-[26rem] flex-col gap-6 p-8 md:p-10">
        <div className="flex items-center gap-4">
          <span
            className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]"
            style={{ color: accent, boxShadow: `0 0 26px -6px ${accent}` }}
          >
            <Icon className="h-7 w-7" style={{ filter: "drop-shadow(0 0 6px currentColor)" }} />
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.28em]" style={{ color: accent }}>
            {label}
          </span>
        </div>

        <h3 className="font-display text-3xl font-semibold md:text-4xl" style={{ color: accent }}>
          {claim}
        </h3>

        <ul className="flex flex-col gap-3">
          {points.map((p) => (
            <li key={p} className="flex items-center gap-3 text-sm text-fog-muted md:text-base">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: accent, boxShadow: `0 0 8px ${accent}` }}
              />
              {p}
            </li>
          ))}
        </ul>

        <div
          aria-hidden
          className="mt-auto grid flex-1 place-items-center transition-transform duration-500 group-hover:scale-[1.06]"
          style={{ color: accent }}
        >
          <div className="aspect-square w-[min(24vh,15rem)] opacity-80 transition-opacity duration-500 group-hover:opacity-100">
            {graphic}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function LockChain(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="7" y="10.5" width="10" height="8" rx="2" />
      <path d="M9 10.5V8.5a3 3 0 0 1 6 0v2" />
      <circle cx="4.5" cy="12" r="1.6" />
      <circle cx="19.5" cy="12" r="1.6" />
      <path d="M6.1 12H7M17 12h.9" />
    </svg>
  );
}
