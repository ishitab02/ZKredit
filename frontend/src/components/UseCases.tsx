import { motion } from "framer-motion";
import Placeholder from "./Placeholder";
import { ArrowUpRight } from "./Icons";
import { fadeUp, inView, stagger } from "../lib/motion";

const CASES = [
  {
    tag: "Lenders",
    title: "Under-collateralised loans",
    body: "Price risk on wallet behaviour, not just collateral. A verified low-risk bucket unlocks better terms: a lower APR and lower collateral requirement.",
  },
  {
    tag: "Protocols",
    title: "Sybil-resistant reputation",
    body: "Distinguish established wallets from fresh, anomalous ones before granting access, airdrops, or governance weight, with a proof, not a heuristic.",
  },
  {
    tag: "Wallets",
    title: "Portable credit identity",
    body: "Carry one private, re-usable attestation across venues. Present the proof; keep your transaction graph to yourself.",
  },
];

export default function UseCases() {
  return (
    <section id="use-cases" className="accent-warm relative py-24 md:py-36">
      <div className="container-page">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={inView}
          className="mb-16 flex flex-col gap-6 md:flex-row md:items-end md:justify-between"
        >
          <div className="max-w-2xl">
            <motion.p variants={fadeUp} className="eyebrow mb-5">
              <span className="accent-dot h-1.5 w-1.5 rounded-full" />
              Use cases
            </motion.p>
            <motion.h2
              variants={fadeUp}
              className="font-display text-display-md font-medium text-fog"
            >
              One proof. Many places to spend it.
            </motion.h2>
          </div>
          <motion.a variants={fadeUp} href="#cta" className="btn-ghost self-start md:self-auto">
            Talk to us
            <ArrowUpRight className="h-4 w-4" />
          </motion.a>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={inView}
          className="grid gap-5 md:grid-cols-3"
        >
          {CASES.map((c) => (
            <motion.article
              key={c.title}
              variants={fadeUp}
              className="surface group overflow-hidden"
            >
              <div className="relative aspect-[4/3] overflow-hidden">
                <Placeholder
                  alt={`${c.title} illustration`}
                  className="absolute inset-0 h-full w-full transition-transform duration-500 ease-smooth group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink-800 via-ink-800/10 to-transparent" />
                <span className="absolute left-4 top-4 rounded-full border border-white/15 bg-ink-900/60 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent-bright)] backdrop-blur-sm">
                  {c.tag}
                </span>
              </div>
              <div className="p-7">
                <h3 className="mb-2.5 font-display text-lg font-semibold text-fog">
                  {c.title}
                </h3>
                <p className="text-sm leading-relaxed text-fog-muted">{c.body}</p>
              </div>
            </motion.article>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
