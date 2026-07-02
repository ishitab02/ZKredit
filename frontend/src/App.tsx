import { useEffect } from "react";
import PageGlow from "./components/PageGlow";
import Nav from "./components/Nav";
import Hero from "./components/Hero";
import Catchphrase from "./components/Catchphrase";
import WhatWeDo from "./components/WhatWeDo";
import HowItWorks from "./components/HowItWorks";
import WhatsProven from "./components/WhatsProven";
import UseCases from "./components/UseCases";
import Footer from "./components/Footer";

export default function App() {
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

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-teal-bright focus:px-4 focus:py-2 focus:font-display focus:text-sm focus:text-ink-900"
      >
        Skip to content
      </a>
      <PageGlow />
      <Nav />
      <main id="main">
        <Hero />
        <Catchphrase />
        <WhatWeDo />
        <HowItWorks />
        <WhatsProven />
        <UseCases />
      </main>
      <Footer />
    </>
  );
}
