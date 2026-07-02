import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Close, Menu } from "./Icons";
import { EASE } from "../lib/motion";

const LINKS = [
  { label: "What we do", href: "#about" },
  { label: "How it works", href: "#how" },
  { label: "What's proven", href: "#proven" },
  { label: "Use cases", href: "#use-cases" },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

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
            href="#top"
            className="flex items-center gap-2.5 text-fog transition-colors hover:text-teal-bright"
            aria-label="ZKredit — home"
          >
            <img
              src="/logo.png"
              alt=""
              className="h-8 w-8 object-contain"
              width={32}
              height={32}
            />
            <span className="font-display text-lg font-semibold tracking-tight">
              ZKredit
            </span>
          </a>

          <ul className="hidden items-center gap-8 md:flex">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="font-sans text-sm text-fog-muted transition-colors hover:text-fog"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="hidden md:block">
            <a href="#cta" className="btn-primary !py-2.5 text-xs">
              Request attestation
              <ArrowUpRight className="h-4 w-4" />
            </a>
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
                {LINKS.map((l) => (
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
                <li className="pt-3">
                  <a
                    href="#cta"
                    onClick={() => setOpen(false)}
                    className="btn-primary w-full justify-center"
                  >
                    Request attestation
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                </li>
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
