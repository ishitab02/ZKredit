import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "framer-motion";
import Placeholder from "./Placeholder";
import { fadeUp, inView, stagger } from "../lib/motion";

type CaseData = {
  tag: string;
  title: string;
  body: string;
  image: string;
  from: { x: number; y: number };
  range: [number, number];
  rest: string;
};

const CASES: CaseData[] = [
  {
    tag: "Lenders",
    title: "Under-collateralised loans",
    body: "Price risk on wallet behaviour, not just collateral. A verified low-risk bucket unlocks better terms: a lower APR and lower collateral requirement.",
    image: "/lenders.jpg",
    from: { x: -220, y: 90 },
    range: [0, 0.5],
    rest: "md:-mt-8",
  },
  {
    tag: "Protocols",
    title: "Sybil-resistant reputation",
    body: "Distinguish established wallets from fresh, anomalous ones before granting access, airdrops, or governance weight, with a proof, not a heuristic.",
    image: "/protocol.jpg",
    from: { x: 0, y: 140 },
    range: [0.2, 0.7],
    rest: "md:-mt-2",
  },
  {
    tag: "Wallets",
    title: "Portable credit identity",
    body: "Carry one private, re-usable attestation across venues. Present the proof; keep your transaction graph to yourself.",
    image: "/wallets.jpg",
    from: { x: 220, y: 90 },
    range: [0.4, 0.9],
    rest: "md:mt-4",
  },
];

export default function UseCases() {
  const gridRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: gridRef,
    offset: ["start 1", "start 0.05"],
  });

  return (
    <section id="use-cases" className="accent-warm relative py-24 md:py-36">
      <div className="container-page">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={inView}
          className="mb-16 max-w-2xl"
        >
          <motion.p variants={fadeUp} className="eyebrow mb-5">
            <span className="accent-dot h-1.5 w-1.5 rounded-full" />
            Use cases
          </motion.p>
          <motion.h2
            variants={fadeUp}
            className="softfloat font-display text-display-md font-medium text-fog"
          >
            One proof. Many places to spend it.
          </motion.h2>
        </motion.div>

        <div ref={gridRef} className="grid gap-5 md:grid-cols-3 md:items-start">
          {CASES.map((c) => (
            <Card key={c.title} data={c} scrollYProgress={scrollYProgress} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Card({ data, scrollYProgress }: { data: CaseData; scrollYProgress: MotionValue<number> }) {
  const reduced = useReducedMotion();
  const opacity = useTransform(scrollYProgress, data.range, [0, 1]);
  const x = useTransform(scrollYProgress, data.range, [data.from.x, 0]);
  const y = useTransform(scrollYProgress, data.range, [data.from.y, 0]);

  return (
    <motion.article
      style={reduced ? undefined : { opacity, x, y }}
      className={`surface group relative overflow-hidden ${data.rest}`}
    >
      <span
        aria-hidden
        className="card-shine pointer-events-none absolute inset-0 opacity-60 transition-opacity duration-500 ease-smooth group-hover:opacity-100"
      />
      <div className="relative aspect-[4/3] overflow-hidden">
        <Placeholder
          src={data.image}
          alt={`${data.title} illustration`}
          className="absolute inset-0 h-full w-full transition-transform duration-500 ease-smooth group-hover:scale-105"
        />
      </div>
      <div className="relative p-7">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent-bright)]">
          {data.tag}
        </p>
        <h3 className="mb-2.5 font-display text-lg font-semibold text-fog">{data.title}</h3>
        <p className="text-sm leading-relaxed text-fog-muted">{data.body}</p>
      </div>
    </motion.article>
  );
}
