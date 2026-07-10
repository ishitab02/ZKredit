import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { ReactLenis, type LenisRef } from "lenis/react";
import PageGlow from "./components/PageGlow";
import Nav from "./components/Nav";
import Footer from "./components/Footer";
import LandingPage from "./pages/LandingPage";
import { getSiteRoute } from "./lib/navigation";

const AttestationPage = lazy(() => import("./pages/AttestationPage"));
const IdentityPage = lazy(() =>
  import("./pages/Identity").then((m) => ({ default: m.Identity })),
);

export default function App() {
  const [route, setRoute] = useState(() => getSiteRoute());
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const lenisRef = useRef<LenisRef>(null);

  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  // Pink fill on primary buttons follows the pointer (--mx/--my).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest?.(".btn-primary") as HTMLElement | null;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      btn.style.setProperty("--mx", `${e.clientX - r.left}px`);
      btn.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    document.addEventListener("pointermove", onMove);
    return () => document.removeEventListener("pointermove", onMove);
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(getSiteRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    // Jump to top on route change without animating (Lenis if present).
    const lenis = lenisRef.current?.lenis;
    if (lenis) lenis.scrollTo(0, { immediate: true });
    else window.scrollTo({ top: 0, behavior: "auto" });
  }, [route]);

  const isAttestation = route === "attestation";
  const isIdentity = route === "identity";

  const content = (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-teal-bright focus:px-4 focus:py-2 focus:font-display focus:text-sm focus:text-ink-900"
      >
        Skip to content
      </a>
      <PageGlow />
      <Nav route={route} />
      <main id="main">
        {isAttestation ? (
          <Suspense fallback={<RouteFallback label="attestation" />}>
            <AttestationPage
              walletAddress={walletAddress}
              onWalletConnected={setWalletAddress}
            />
          </Suspense>
        ) : isIdentity ? (
          <Suspense fallback={<RouteFallback label="identity" />}>
            <section className="relative overflow-hidden pt-28 pb-24 md:pt-32 md:pb-36">
              <div className="container-page relative z-10">
                <IdentityPage />
              </div>
            </section>
          </Suspense>
        ) : (
          <LandingPage />
        )}
      </main>
      <Footer route={route} />
    </>
  );

  // Reduced-motion users get native scrolling; everyone else gets Lenis inertia.
  // `anchors` makes in-page #links smooth-scroll with a nav-clearing offset.
  if (prefersReduced) return content;

  return (
    <ReactLenis
      root
      ref={lenisRef}
      options={{ lerp: 0.09, wheelMultiplier: 1, anchors: { offset: -96 } }}
    >
      {content}
    </ReactLenis>
  );
}

function RouteFallback({ label }: { label: "attestation" | "identity" }) {
  const copy =
    label === "identity"
      ? {
          heading: "Loading identity route",
          detail: "Preparing the identity, wallet-linking, and KYC flow.",
        }
      : {
          heading: "Loading attestation route",
          detail: "Preparing the wallet attestation flow and contract client.",
        };
  return (
    <section className="relative overflow-hidden pt-28 pb-24 md:pt-32 md:pb-36">
      <div className="container-page relative z-10">
        <div className="mx-auto max-w-2xl">
          <div className="surface p-6 md:p-8">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-fog-faint">
              {copy.heading}
            </p>
            <p className="mt-3 text-sm text-fog-muted">{copy.detail}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
