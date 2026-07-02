import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";

/** Two lines fly in from opposite bottom corners and settle stacked, then drift
 *  up-left. Continuous motion (no static plateau). */
export default function Catchphrase() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });

  // "Private Credit," from bottom-right → centre → top-left.
  // "Publicly Proven" from bottom-left  → centre → top-right.
  // Settles centred around mid-scroll (when the section is centred on screen).
  const stops = [0, 0.4, 0.6, 1];
  const l1x = useTransform(scrollYProgress, stops, ["46vw", "0vw", "0vw", "-46vw"]);
  const l1y = useTransform(scrollYProgress, stops, ["40vh", "0vh", "0vh", "-46vh"]);
  const l2x = useTransform(scrollYProgress, stops, ["-46vw", "0vw", "0vw", "46vw"]);
  const l2y = useTransform(scrollYProgress, stops, ["44vh", "0vh", "0vh", "-46vh"]);
  const opacity = useTransform(scrollYProgress, [0, 0.1, 0.85, 1], [0, 1, 1, 0.4]);
  const glowX = useTransform(scrollYProgress, [0, 1], ["18%", "72%"]);

  const s1 = reduced ? {} : { x: l1x, y: l1y };
  const s2 = reduced ? {} : { x: l2x, y: l2y };

  return (
    <section ref={ref} className="relative h-[190vh]" aria-label="Private credit, publicly proven">
      <div className="sticky top-0 flex h-dvh items-center justify-center overflow-hidden">
        <motion.div
          aria-hidden="true"
          style={{ left: glowX }}
          className="glow top-1/2 h-[52vmin] w-[52vmin] -translate-y-1/2"
        />
        <motion.div
          style={reduced ? undefined : { opacity }}
          className="relative z-10 w-full px-6 text-center"
        >
          <h2 className="sr-only">Private Credit, Publicly Proven</h2>
          <motion.span
            aria-hidden="true"
            style={s1}
            className="block font-display text-display-xl font-semibold text-fog"
          >
            Private Credit,
          </motion.span>
          <motion.span
            aria-hidden="true"
            style={s2}
            className="block font-display text-display-xl font-semibold text-gradient-teal"
          >
            Publicly Proven
          </motion.span>
        </motion.div>
      </div>
    </section>
  );
}
