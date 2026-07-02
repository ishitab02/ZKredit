import { motion } from "framer-motion";
import { ArrowUpRight } from "./Icons";
import { fadeUp, inView, stagger } from "../lib/motion";

const COLS = [
  {
    heading: "Product",
    links: [
      { label: "How it works", href: "#how" },
      { label: "What's proven", href: "#proven" },
      { label: "Use cases", href: "#use-cases" },
    ],
  },
  {
    heading: "Network",
    links: [
      { label: "Stellar / Soroban", href: "#how" },
      { label: "Attestations", href: "#proven" },
      { label: "Roadmap", href: "#about" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "#about" },
      { label: "Contact", href: "#cta" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="relative overflow-hidden">
      <section id="cta" className="relative py-28 md:py-40">
        <div className="glow left-1/2 top-1/2 h-[54vmin] w-[80vmin] -translate-x-1/2 -translate-y-1/2 animate-pulseglow" />
        <div className="absolute inset-0 bg-dotgrid opacity-30" />
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={inView}
          className="container-page relative z-10 flex flex-col items-center text-center"
        >
          <motion.h2
            variants={fadeUp}
            className="max-w-3xl font-display text-display-md font-semibold text-fog"
          >
            Give your wallet a <span className="text-gradient">credit identity</span>{" "}
            it can prove.
          </motion.h2>
          <motion.p
            variants={fadeUp}
            className="mt-6 max-w-xl text-base leading-relaxed text-fog-muted"
          >
            Request an attestation, or talk to us about integrating ZKredit into
            your lending protocol.
          </motion.p>
          <motion.div variants={fadeUp} className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
            <a href="mailto:hello@zkredit.xyz" className="btn-primary">
              Request attestation
              <ArrowUpRight className="h-4 w-4" />
            </a>
            <a href="#how" className="btn-ghost">
              Read the docs
            </a>
          </motion.div>
        </motion.div>
      </section>

      <div className="hairline">
        <div className="container-page grid gap-12 py-16 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <a href="#top" className="flex items-center gap-2.5 text-fog" aria-label="ZKredit — home">
              <img src="/logo.png" alt="" className="h-8 w-8 object-contain" width={32} height={32} />
              <span className="font-display text-lg font-semibold tracking-tight">ZKredit</span>
            </a>
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-fog-muted">
              Zero-knowledge credit attestations for the on-chain economy.
              Private by default, provable on demand.
            </p>
          </div>

          {COLS.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h3 className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-fog-faint">
                {col.heading}
              </h3>
              <ul className="flex flex-col gap-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href} className="text-sm text-fog-muted transition-colors hover:text-fog">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="hairline">
          <div className="container-page flex flex-col items-center justify-between gap-3 py-7 text-xs text-fog-faint sm:flex-row">
            <p>© {new Date().getFullYear()} ZKredit. All rights reserved.</p>
            <p className="font-mono">Built on Stellar · Proofs by EZKL (Halo2-KZG)</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
