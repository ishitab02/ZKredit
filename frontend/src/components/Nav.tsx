import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Close, Menu } from "./Icons";
import { EASE } from "../lib/motion";
import { ATTESTATION_PATH, LANDING_PATH, type SiteRoute } from "../lib/navigation";

// Absolute (root-anchored) hrefs so the section links also work from the
// attestation page: a click navigates back to the landing page and scrolls.
const LANDING_LINKS = [
  { label: "What we do", href: "/#about" },
  { label: "How it works", href: "/#how" },
  { label: "What's proven", href: "/#proven" },
  { label: "Use cases", href: "/#use-cases" },
];

export default function Nav({ route = "landing" }: { route?: SiteRoute }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  // Section links show on every route. The landing shows a "Request attestation"
  // CTA; the attestation page connects the wallet from its own panel, so the nav
  // there shows only the network pill.
  const links = LANDING_LINKS;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="fixed inset-x-0 top-0 z-[100]">
      <div className="container-page pt-3 md:pt-4">
        <nav
          className={`glass flex h-14 items-center justify-between rounded-2xl pl-4 pr-3 transition-shadow duration-300 md:h-16 md:pl-6 md:pr-4 ${
            scrolled ? "shadow-2xl shadow-black/40" : ""
          }`}
        >
          <a
            href={LANDING_PATH}
            className="flex items-center gap-2.5 text-fog transition-colors hover:text-teal-bright"
            aria-label="ZKredit — home"
          >
            <img
              src="/logo.png"
              alt=""
              className="h-10 w-10 object-contain md:h-12 md:w-12"
              width={48}
              height={48}
            />
            <span className="font-display text-xl font-semibold tracking-tight md:text-2xl">
              ZKredit
            </span>
          </a>

          <ul className="hidden items-center gap-8 md:flex">
            {links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="font-sans text-sm font-bold text-fog-muted transition-colors hover:text-fog"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="hidden items-center gap-3 md:flex">
            {route === "attestation" && (
              <span className="testnet-pulse inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-bright opacity-70" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-bright" />
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fog-muted">
                  Stellar Testnet
                </span>
              </span>
            )}
            {route === "landing" && (
              <a href={ATTESTATION_PATH} className="btn-primary !py-2.5 text-xs">
                Request attestation
              </a>
            )}
          </div>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-fog md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            {open ? <Close className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </nav>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="glass mt-2 overflow-hidden rounded-2xl md:hidden"
            >
              <ul className="flex flex-col p-4">
                {links.map((l) => (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      onClick={() => setOpen(false)}
                      className="block py-3 font-display text-lg text-fog"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
                {route === "landing" && (
                  <li className="pt-3">
                    <a
                      href={ATTESTATION_PATH}
                      onClick={() => setOpen(false)}
                      className="btn-primary w-full justify-center"
                    >
                      Request attestation
                    </a>
                  </li>
                )}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
