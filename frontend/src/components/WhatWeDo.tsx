import { useRef, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { Pulse, ShieldCheck, Cube, Nodes, Lock } from "./Icons";
import { fadeDown, fadeUp, inView, stagger } from "../lib/motion";

const cx = (...c: Array<string | false | null | undefined>) =>
  c.filter(Boolean).join(" ");

/** Local stroke icon matching ./Icons for the Lend row. */
function Coins(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <ellipse cx="9" cy="7" rx="5" ry="2.5" />
      <path d="M4 7v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5" />
      <path d="M10 14.3V16c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4c0-1.4-2.2-2.5-5-2.5-.6 0-1.1.05-1.6.13" />
    </svg>
  );
}

type Capability = {
  word: string;
  blurb: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
};

const CAPABILITIES: Capability[] = [
  {
    word: "Score",
    blurb:
      "Turn any wallet's real on-chain history into a 300 to 850 behavioural risk score, a credit read for crypto",
    Icon: Pulse,
  },
  {
    word: "Prove",
    blurb:
      "Generate a zero-knowledge proof that the score is honest, verifiable without revealing a single transaction",
    Icon: ShieldCheck,
  },
  {
    word: "Attest",
    blurb:
      "Anchor the result on Stellar as a portable, tamper-proof attestation any protocol can read",
    Icon: Cube,
  },
  {
    word: "Lend",
    blurb:
      "Let lenders price risk on behaviour, not just collateral. Lower APR and collateral for verified low-risk wallets",
    Icon: Coins,
  },
  {
    word: "Explain",
    blurb:
      "Every score ships with its top signals and reason codes. A transparent read of the wallet, never a black box",
    Icon: Nodes,
  },
  {
    word: "Protect",
    blurb:
      "Raw wallet data never touches the chain. Only the risk bucket, confidence, and model hashes go on-chain",
    Icon: Lock,
  },
];

export default function WhatWeDo() {
  const reduce = useReducedMotion();
  const listRef = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);

  // Continuous scroll-position → index mapping instead of per-row viewport
  // enter/leave events. Discrete IntersectionObserver callbacks can be
  // skipped entirely on a fast scroll (two rows' enter+leave collapsing into
  // the same React batch), which is what was causing rows to get passed over
  // without ever lighting up. A single scroll-linked value can't skip an
  // index — it sweeps through every one of them in order.
  const { scrollYProgress } = useScroll({
    target: listRef,
    offset: ["start center", "end center"],
  });
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    const idx = Math.round(v * (CAPABILITIES.length - 1));
    setActive(Math.min(CAPABILITIES.length - 1, Math.max(0, idx)));
  });

  return (
    <section id="about" className="relative overflow-hidden py-28 md:py-40">
      <div
        className="glow left-1/2 top-1/3 h-[34rem] w-[34rem] -translate-x-1/2"
        aria-hidden
      />

      <div className="container-page relative z-10">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={inView}
          className="mb-14 flex flex-col items-center text-center md:mb-20"
        >
          <motion.p variants={fadeDown} className="eyebrow mb-5">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-bright" />
            What we do
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: -120 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={inView}
            transition={
              reduce
                ? { duration: 0.3 }
                : { type: "spring", stiffness: 90, damping: 12, opacity: { duration: 0.3 } }
            }
            className="max-w-2xl"
          >
            <h2 className="softfloat font-display text-display-md font-medium text-fog">
              One wallet read, <span className="text-gradient">six ways</span> to
              use it
            </h2>
          </motion.div>
        </motion.div>

        <motion.ul
          ref={listRef}
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={inView}
          className="relative flex w-full flex-col"
        >
          {CAPABILITIES.map((c, i) => (
            <CapabilityRow
              key={c.word}
              capability={c}
              index={i}
              reduce={reduce}
              isActive={active === i}
            />
          ))}
        </motion.ul>
      </div>
    </section>
  );
}

function CapabilityRow({
  capability: c,
  index: i,
  reduce,
  isActive,
}: {
  capability: Capability;
  index: number;
  reduce: boolean | null;
  isActive: boolean;
}) {
  return (
    <motion.li variants={fadeUp}>
      <div
        aria-describedby={`cap-${i}`}
        className="group relative flex w-full items-center justify-center rounded-2xl py-5 md:py-7"
      >
        <span
          aria-hidden
          className={cx(
            "card-shine pointer-events-none absolute inset-x-0 inset-y-1 transition-opacity duration-500 ease-smooth",
            isActive ? "opacity-100 shadow-[0_28px_80px_-30px_rgba(250,209,255,0.5)]" : "opacity-0",
          )}
        />

        <span
          aria-hidden
          className={cx(
            "absolute left-4 top-1/2 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-xl border bg-white/[0.03] transition-all duration-500 ease-smooth md:grid md:left-8 lg:left-12 lg:h-14 lg:w-14",
            isActive
              ? "translate-x-0 border-haze-pink/25 text-haze-pink opacity-100"
              : "-translate-x-3 border-white/10 text-teal-bright opacity-0",
          )}
        >
          <motion.span
            className="grid place-items-center"
            animate={
              isActive
                ? { scale: 1, rotate: 0, opacity: 1 }
                : { scale: 0.5, rotate: -25, opacity: 0 }
            }
            transition={
              reduce ? { duration: 0.2 } : { type: "spring", stiffness: 420, damping: 13 }
            }
          >
            <c.Icon className="h-6 w-6" />
          </motion.span>
        </span>

        <span
          className={cx(
            "relative font-display font-medium leading-none transition-[color,opacity,transform] duration-300 ease-smooth",
            "text-[2.75rem] sm:text-6xl md:text-[clamp(3rem,6vw,5.25rem)]",
            isActive ? "text-gradient md:scale-[1.02]" : "text-fog-faint/55",
          )}
        >
          {c.word}
        </span>

        <span
          id={`cap-${i}`}
          className={cx(
            "absolute right-4 top-1/2 hidden max-w-[15rem] -translate-y-1/2 text-left text-sm leading-relaxed text-fog-muted transition-all duration-500 ease-smooth md:block md:right-8 lg:right-12 lg:max-w-[19rem]",
            isActive ? "translate-x-0 opacity-100" : "translate-x-3 opacity-0",
          )}
        >
          {c.blurb}
        </span>
      </div>

      <p
        aria-hidden
        className="mx-auto mb-3 max-w-sm px-4 text-center text-sm leading-relaxed text-fog-muted md:hidden"
      >
        {c.blurb}
      </p>
      {i < CAPABILITIES.length - 1 && <span aria-hidden className="hairline block w-full md:hidden" />}
    </motion.li>
  );
}
