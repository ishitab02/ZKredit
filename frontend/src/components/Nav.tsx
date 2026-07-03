import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Close, Menu } from "./Icons";
import { EASE } from "../lib/motion";
import { ATTESTATION_PATH, LANDING_PATH, type SiteRoute } from "../lib/navigation";
import { connectFreighter } from "../lib/freighter";

const LANDING_LINKS = [
  { label: "What we do", href: "#about" },
  { label: "How it works", href: "#how" },
  { label: "What's proven", href: "#proven" },
  { label: "Use cases", href: "#use-cases" },
];

function shorten(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export default function Nav({
  route = "landing",
  walletAddress = null,
  onWalletConnected,
}: {
  route?: SiteRoute;
  walletAddress?: string | null;
  onWalletConnected?: (address: string) => void;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const links = route === "landing" ? LANDING_LINKS : [{ label: "Start attestation", href: `${ATTESTATION_PATH}#attestation` }];

  async function handleConnect() {
    setConnecting(true);
    try {
      const address = await connectFreighter();
      onWalletConnected?.(address);
    } catch {
      // Freighter unavailable or the user declined — leave the field to manual entry.
    } finally {
      setConnecting(false);
    }
  }

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
              className="h-8 w-8 object-contain"
              width={32}
              height={32}
            />
            <span className="font-display text-lg font-semibold tracking-tight">
              ZKredit
            </span>
          </a>

          <ul className="hidden items-center gap-8 md:flex">
            {route === "landing" &&
              links.map((l) => (
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
            {route === "landing" ? (
              <a href={ATTESTATION_PATH} className="btn-primary !py-2.5 text-xs">
                Request attestation
              </a>
            ) : (
              <button
                type="button"
                onClick={() => void handleConnect()}
                disabled={connecting}
                className="btn-primary !py-2.5 text-xs disabled:opacity-60"
              >
                {walletAddress ? shorten(walletAddress) : connecting ? "Connecting…" : "Connect Freighter"}
              </button>
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
                <li className="pt-3">
                  {route === "landing" ? (
                    <a
                      href={ATTESTATION_PATH}
                      onClick={() => setOpen(false)}
                      className="btn-primary w-full justify-center"
                    >
                      Request attestation
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        void handleConnect();
                        setOpen(false);
                      }}
                      disabled={connecting}
                      className="btn-primary w-full justify-center disabled:opacity-60"
                    >
                      {walletAddress ? shorten(walletAddress) : connecting ? "Connecting…" : "Connect Freighter"}
                    </button>
                  )}
                </li>
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
