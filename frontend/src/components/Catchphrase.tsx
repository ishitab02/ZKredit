import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion";

/** Two lines fly in from opposite bottom corners and settle stacked, then drift
 *  up-left. Continuous motion (no static plateau). */
export default function Catchphrase() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });

  // Spring-smoothed progress so the text glides continuously instead of
  // snapping 1:1 to raw scroll ticks — it keeps drifting for a moment even
  // once the scroll input itself has stopped.
  const smoothProgress = useSpring(scrollYProgress, { stiffness: 45, damping: 16, mass: 0.6 });

  // "Private Credit," from bottom-right corner, straight through centre, to
  // top-left corner. "Publicly Proven" from bottom-left, through centre, to
  // top-right. Only 3 stops — center is a single instant they cross through
  // mid-flight, never a held position. vmax on both axes keeps the path a
  // true diagonal regardless of viewport aspect ratio.
  // Every stop in each array stays in the same CSS unit (vmax) — mixing units
  // (e.g. a "0vw" placeholder alongside "62vmax") makes Framer's interpolator
  // silently resolve the whole array against the wrong axis, which is why
  // this previously landed as a shallow vw/vh sweep instead of a true corner.
  const stops = [0, 0.5, 1];
  const l1x = useTransform(smoothProgress, stops, ["62vmax", "0vmax", "-62vmax"]);
  const l1y = useTransform(smoothProgress, stops, ["62vmax", "0vmax", "-62vmax"]);
  const l2x = useTransform(smoothProgress, stops, ["-62vmax", "0vmax", "62vmax"]);
  const l2y = useTransform(smoothProgress, stops, ["62vmax", "0vmax", "-62vmax"]);
  const opacity = useTransform(smoothProgress, [0, 0.08, 0.92, 1], [0, 1, 1, 0.4]);
  const glowX = useTransform(smoothProgress, [0, 1], ["18%", "72%"]);

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
