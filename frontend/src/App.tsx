import { useEffect, useState } from "react";
import PageGlow from "./components/PageGlow";
import Nav from "./components/Nav";
import Footer from "./components/Footer";
import LandingPage from "./pages/LandingPage";
import AttestationPage from "./pages/AttestationPage";
import { getSiteRoute } from "./lib/navigation";

export default function App() {
  const [route, setRoute] = useState(() => getSiteRoute());

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
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [route]);

  const isAttestation = route === "attestation";

  return (
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
        {isAttestation ? <AttestationPage /> : <LandingPage />}
      </main>
      <Footer route={route} />
    </>
  );
}
