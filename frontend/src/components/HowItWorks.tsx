import { useRef, useState, type CSSProperties } from "react";
import {
  motion,
  useMotionValueEvent,
  useScroll,
  useTransform,
} from "framer-motion";
import StepVisual from "./HowVisuals";
import { fadeUp, inView, stagger } from "../lib/motion";

// Magenta of the "Provable" P (for HOW); lighter pink for the rings/thread.
const PURPLE = "#ef8dff";
const RING = "#f7b8ff";
const RING_RGB = "247,184,255";

type Step = {
  n: string;
  title: string;
  blurb: string;
  cta: string;
  accent: string; // cool, non-green
};

const STEPS: Step[] = [
  {
    n: "01",
    title: "Read a wallet",
    blurb:
      "We read a wallet's public Stellar history straight from the ledger: how active it is, its payment mix, trustlines, counterparties, and how old and recent it is. Nothing private, nothing off-chain",
    cta: "Check a wallet's history",
    accent: "#5E9BFF",
  },
  {
    n: "02",
    title: "Score behaviour",
    blurb:
      "An unsupervised model ranks the wallet against thousands of others and returns a risk bucket plus a FICO-style score. It reads real behaviour, so it never feels like a black box",
    cta: "Score a wallet's risk",
    accent: "#A17BFF",
  },
  {
    n: "03",
    title: "Prove in zero-knowledge",
    blurb:
      "A distilled model runs inside a zero-knowledge circuit and proves the score is correct, without ever exposing the wallet's features or its transactions",
    cta: "Prove a score privately",
    accent: "#E86AF0",
  },
  {
    n: "04",
    title: "Attest on-chain",
    blurb:
      "We anchor the risk bucket, confidence and model hashes on Soroban, so any lender gets a portable, tamper-proof attestation they can verify themselves",
    cta: "Attest a wallet on-chain",
    accent: "#FF7BC0",
  },
];

const PANELS = STEPS.length + 1;

export default function HowItWorks() {
  return (
    <section id="how" className="relative">
      <HowDesktop />
      <HowMobile />
    </section>
  );
}

function HowDesktop() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ["start start", "end end"],
  });

  const x = useTransform(scrollYProgress, [0, 1], ["0vw", `-${(PANELS - 1) * 100}vw`]);

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    setActive(Math.min(PANELS - 1, Math.max(0, Math.round(v * (PANELS - 1)))));
  });

  return (
    <div ref={trackRef} className="relative hidden h-[520vh] md:block">
      <div className="sticky top-0 h-screen overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-dotgrid opacity-20" />
        <motion.div style={{ x }} className="flex h-full w-max">
          <IntroPanel />
          {STEPS.map((s, i) => (
            <StepPanel key={s.n} step={s} index={i} active={active === i + 1} />
          ))}
        </motion.div>
      </div>
    </div>
  );
}

function IntroPanel() {
  return (
    <div className="relative flex h-full w-screen shrink-0 items-center overflow-hidden">
      <Rings />
      <div className="relative z-10 flex w-full -translate-y-[3vh] flex-col items-end pr-[5vw] text-right md:pr-[6vw]">
        <p className="eyebrow mb-6" style={{ color: PURPLE }}>
          The pipeline
        </p>
        <h2 className="font-display text-[clamp(3rem,9vw,8rem)] font-semibold leading-[0.92] tracking-tight">
          <span style={{ color: PURPLE }}>HOW</span>{" "}
          <span className="text-fog">IT WORKS</span>
        </h2>
        <p className="mt-16 max-w-md text-lg leading-relaxed text-fog-muted">
          From a raw ledger to a proof a lender can trust, in four steps
        </p>
      </div>
    </div>
  );
}

/* Concentric circles centred just right of the left edge (mid-height), so the
   fan tapers to a point at the edge itself (ref: reference/1.png) instead of
   cutting off at full width. Static, thick, lighter pink, glowing. */
function Rings() {
  const CY = "52%";
  const CX = "9vw";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="ring-breathe absolute" style={{ top: CY, left: CX }}>
        {Array.from({ length: 15 }).map((_, i) => {
          const d = (i + 1) * 5.2;
          const op = Math.max(0.24, 0.68 - i * 0.03);
          return (
            <div
              key={i}
              className="absolute left-0 top-0 rounded-full"
              style={{
                width: `${d}vh`,
                height: `${d}vh`,
                transform: "translate(-50%, -50%)",
                border: `2.5px solid rgba(${RING_RGB},${op})`,
                boxShadow: `0 0 26px rgba(${RING_RGB},${op * 0.85}), 0 0 8px rgba(${RING_RGB},${Math.min(1, op * 1.2)})`,
              }}
            />
          );
        })}
      </div>
      <div
        className="absolute left-0 h-[3px] w-full"
        style={{ top: CY, transform: "translateY(-50%)", background: `rgba(${RING_RGB},0.4)` }}
      />
      {[8, 20, 32, 44].map((v) => (
        <span
          key={v}
          className="absolute h-2 w-2 rounded-full"
          style={{
            left: `${v}vw`,
            top: CY,
            transform: "translate(-50%, -50%)",
            background: RING,
            boxShadow: `0 0 10px ${RING}`,
          }}
        />
      ))}
    </div>
  );
}

/* White title first; hover reveals the fully-coloured animation + copy. */
function StepPanel({
  step,
  index,
  active,
}: {
  step: Step;
  index: number;
  active: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const revealed = hovered && active;

  return (
    <div className="relative flex h-full w-screen shrink-0 items-center justify-center">
      <motion.div
        aria-hidden
        animate={{ opacity: revealed ? 1 : 0 }}
        transition={{ duration: 0.55 }}
        className="absolute inset-0"
        style={{
          background: `linear-gradient(165deg, color-mix(in srgb, ${step.accent} 30%, #06060c) 0%, color-mix(in srgb, ${step.accent} 60%, #08060e) 55%, color-mix(in srgb, ${step.accent} 90%, #0b0812) 100%)`,
        }}
      />

      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="relative z-10 mx-auto flex h-full w-full max-w-3xl items-center justify-center px-6"
      >
        <motion.h3
          animate={{ opacity: revealed ? 0 : 1 }}
          transition={{ duration: 0.4 }}
          className={`pointer-events-none absolute font-display text-6xl font-medium lg:text-7xl ${
            active ? "text-fog" : "text-white/20"
          }`}
        >
          {step.title}
        </motion.h3>

        <motion.div
          animate={{ opacity: revealed ? 1 : 0, y: revealed ? 0 : 14 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col items-center gap-8 text-center"
          style={{ pointerEvents: revealed ? "auto" : "none" }}
        >
          <div>
            <span
              className="font-mono text-base"
              style={{ color: `color-mix(in srgb, ${step.accent} 20%, #ffffff)` }}
            >
              {index + 1}
            </span>
            <h3 className="mt-2 font-display text-5xl font-medium leading-[1.02] text-white lg:text-6xl">
              {step.title}
            </h3>
            <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-white/85">
              {step.blurb}
            </p>
          </div>

          <div
            className="relative aspect-square w-[min(32vh,20rem)]"
            style={{ color: `color-mix(in srgb, ${step.accent} 18%, #ffffff)` }}
          >
            <StepVisual step={index} />
          </div>

          <a
            href="#cta"
            className="btn-glow"
            style={{ ["--btn-accent"]: step.accent } as CSSProperties}
          >
            {step.cta}
          </a>
        </motion.div>
      </div>
    </div>
  );
}

function HowMobile() {
  return (
    <div className="container-page py-20 md:hidden">
      <motion.div
        variants={stagger}
        initial="hidden"
        whileInView="show"
        viewport={inView}
        className="mb-12"
      >
        <motion.p variants={fadeUp} className="eyebrow mb-4" style={{ color: PURPLE }}>
          The pipeline
        </motion.p>
        <motion.h2
          variants={fadeUp}
          className="font-display text-display-md font-semibold text-fog"
        >
          <span style={{ color: PURPLE }}>How</span> it works
        </motion.h2>
      </motion.div>

      <ol className="flex flex-col gap-16">
        {STEPS.map((s, i) => (
          <motion.li
            key={s.n}
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={inView}
            className="flex flex-col gap-6"
          >
            <div className="relative mx-auto h-56 w-56" style={{ color: s.accent }}>
              <StepVisual step={i} />
            </div>
            <div>
              <span className="font-mono text-base" style={{ color: s.accent }}>
                {i + 1}
              </span>
              <h3 className="mt-2 font-display text-3xl font-medium text-fog">
                {s.title}
              </h3>
              <p className="mt-3 text-base leading-relaxed text-fog-muted">
                {s.blurb}
              </p>
            </div>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}
