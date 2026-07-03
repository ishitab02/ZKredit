import { motion } from "framer-motion";
import { ArrowUpRight } from "./Icons";
import { fadeUp, inView, stagger } from "../lib/motion";
import { ATTESTATION_PATH, LANDING_PATH, type SiteRoute } from "../lib/navigation";

const DOCS_URL = "https://github.com/ishitab02/ZKredit/blob/main/docs/architecture.md";
const GITHUB_URL = "https://github.com/ishitab02/ZKredit";
const X_URL = "https://x.com/Zkred_it";

const NETWORK_LINKS = [
  { label: "GitHub", href: GITHUB_URL },
  { label: "Docs", href: DOCS_URL },
  { label: "X", href: X_URL },
];

export default function Footer({ route = "landing" }: { route?: SiteRoute }) {
  const prefix = route === "landing" ? "" : LANDING_PATH;
  const cols = [
    {
      heading: "Product",
      links: [
        { label: "How it works", href: `${prefix}#how` },
        { label: "What's proven", href: `${prefix}#proven` },
        { label: "Use cases", href: `${prefix}#use-cases` },
      ],
    },
    {
      heading: "Network",
      links: NETWORK_LINKS,
    },
  ];

  return (
    <footer className="relative overflow-hidden">
      {route === "landing" && (
        <section id="contact" className="relative py-28 md:py-40">
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
              it can prove
            </motion.h2>
            <motion.div variants={fadeUp} className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
              <a href={ATTESTATION_PATH} className="btn-primary">
                Get started
                <ArrowUpRight className="h-4 w-4" />
              </a>
              <a href={DOCS_URL} className="btn-ghost">
                Read the docs
              </a>
            </motion.div>
          </motion.div>
        </section>
      )}

      <div className="hairline">
        <div className="container-page flex flex-col gap-12 py-16 md:flex-row md:items-start md:justify-between md:gap-12">
          <div className="max-w-xs">
            <a
              href={route === "landing" ? "#top" : LANDING_PATH}
              className="flex items-center gap-2.5 text-fog"
              aria-label="ZKredit — home"
            >
              <img src="/logo.png" alt="" className="h-8 w-8 object-contain" width={32} height={32} />
              <span className="font-display text-lg font-semibold tracking-tight">ZKredit</span>
            </a>
            <p className="mt-5 text-sm leading-relaxed text-fog-muted">
              Zero-knowledge credit attestations for the on-chain economy.
              Private by default, provable on demand.
            </p>
          </div>

          <div className="flex flex-col gap-10 sm:flex-row sm:gap-20">
            {cols.map((col) => (
              <nav key={col.heading} aria-label={col.heading}>
                <h3 className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-fog-faint">
                  {col.heading}
                </h3>
                <ul className="flex flex-col gap-3">
                  {col.links.map((l) => {
                    const external = l.href.startsWith("http");
                    return (
                      <li key={l.label}>
                        <a
                          href={l.href}
                          target={external ? "_blank" : undefined}
                          rel={external ? "noopener noreferrer" : undefined}
                          className="text-sm text-fog-muted transition-colors hover:text-fog"
                        >
                          {l.label}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="hairline">
          <div className="container-page flex flex-col items-center justify-between gap-3 py-7 text-xs text-fog-faint sm:flex-row">
            <p>© {new Date().getFullYear()} ZKredit. All rights reserved.</p>
            <p className="font-mono">Built on Stellar</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
