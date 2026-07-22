import { lazy, Suspense } from "react";

const MermaidImpl = lazy(() => import("./MermaidImpl"));

export default function Mermaid({ chart }: { chart: string }) {
  return (
    <Suspense fallback={<div className="mermaid-diagram animate-pulse text-xs text-fog-faint">Rendering diagram...</div>}>
      <MermaidImpl chart={chart} />
    </Suspense>
  );
}
