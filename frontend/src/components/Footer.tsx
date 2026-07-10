import { motion } from "framer-motion";
import { ArrowUpRight, Github, XLogo } from "./Icons";
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

const SOCIALS = [
  { label: "GitHub", href: GITHUB_URL, Icon: Github },
  { label: "X", href: X_URL, Icon: XLogo },
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
        <div className="container-page grid grid-cols-1 gap-12 py-16 md:grid-cols-[1.4fr_1fr_1fr] md:gap-10 lg:py-20">
          <div className="max-w-sm">
            <a
              href={route === "landing" ? "#top" : LANDING_PATH}
              className="inline-flex items-center gap-3 text-fog transition-colors hover:text-teal-bright"
              aria-label="ZKredit — home"
            >
              <img src="/logo.png" alt="" className="h-12 w-12 object-contain" width={48} height={48} />
              <span className="font-display text-2xl font-semibold tracking-tight">ZKredit</span>
            </a>
            <p className="mt-5 text-sm leading-relaxed text-fog-muted">
              Zero-knowledge credit attestations for the on-chain economy.
              Private by default, provable on demand.
            </p>

            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-bright opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-bright" />
              </span>
              <span className="font-mono text-xs uppercase tracking-[0.16em] text-fog-muted">
                Stellar Mainnet · Live
              </span>
            </div>

            <div className="mt-6 flex items-center gap-3">
              {SOCIALS.map(({ label, href, Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] text-fog-muted transition-colors hover:border-teal-bright/40 hover:text-teal-bright"
                >
                  <Icon className="h-[18px] w-[18px]" />
                </a>
              ))}
            </div>
          </div>

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
                        className="group inline-flex items-center gap-1.5 text-sm text-fog-muted transition-colors hover:text-fog"
                      >
                        {l.label}
                        {external && (
                          <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                        )}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ))}
        </div>

        {/* Oversized brand wordmark — clipped decorative band. */}
        <div className="container-page pointer-events-none select-none overflow-hidden" aria-hidden="true">
          <span className="text-gradient block whitespace-nowrap text-center font-display text-[min(19vw,245px)] font-semibold leading-none tracking-tight opacity-[0.07]">
            ZKREDIT
          </span>
        </div>

        <div className="hairline">
          <div className="container-page flex flex-col items-center justify-between gap-3 py-7 text-xs text-fog-faint sm:flex-row">
            <p>© {new Date().getFullYear()} ZKredit. All rights reserved.</p>
            <div className="flex items-center gap-5">
              <p className="font-mono">Built on Stellar</p>
              <a
                href={route === "landing" ? "#top" : LANDING_PATH}
                className="inline-flex items-center gap-1 font-mono uppercase tracking-[0.16em] transition-colors hover:text-fog"
              >
                Back to top
                <ArrowUpRight className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
