import { Suspense, lazy } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight } from "./Icons";
import { EASE } from "../lib/motion";
import { ATTESTATION_PATH } from "../lib/navigation";

const ParticleSphere = lazy(() => import("../three/ParticleSphere"));

export default function Hero() {
  return (
    <section
      id="top"
      className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden pt-24"
    >
      <div className="absolute inset-0 bg-dotgrid opacity-40" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink-900/40 via-transparent to-ink-900/60" />

      {/* Interactive particle sphere, anchored low. */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center">
        <Suspense fallback={null}>
          <ParticleSphere className="h-[84vw] w-[84vw] max-h-[720px] max-w-[720px] cursor-grab active:cursor-grabbing" />
        </Suspense>
      </div>

      <div className="container-page relative z-10 flex flex-col items-center text-center pointer-events-none">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="eyebrow mb-6"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-teal-bright" />
          Zero-knowledge credit oracle
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.05 }}
          className="max-w-4xl font-display text-display-lg font-semibold text-fog"
        >
          Making On-Chain
          <br />
          Credit <span className="text-gradient">Provable</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.15 }}
          className="mt-7 max-w-xl text-base leading-relaxed text-fog-muted md:text-lg"
        >
          ZKredit turns a wallet's on-chain history into a risk attestation, and
          proves it in zero-knowledge, without revealing a single transaction.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.25 }}
          className="pointer-events-auto mt-10 flex flex-col items-center gap-4 sm:flex-row"
        >
          <a href={ATTESTATION_PATH} className="btn-primary">
            Request attestation
            <ArrowUpRight className="h-4 w-4" />
          </a>
          <a href="#how" className="btn-ghost">
            See how it works
          </a>
        </motion.div>
      </div>
    </section>
  );
}
