import type { Variants } from "framer-motion";

export const EASE = [0.22, 1, 0.36, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

export const fadeDown: Variants = {
  hidden: { opacity: 0, y: -90 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      y: { type: "spring", stiffness: 110, damping: 13 },
      opacity: { duration: 0.25, ease: EASE },
    },
  },
};

export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

export const inView = { once: true, amount: 0.3 } as const;
