import { useEffect, useId, useState } from "react";
import mermaid from "mermaid";

let initialized = false;
function ensureInitialized() {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    themeVariables: {
      darkMode: true,
      background: "transparent",
      primaryColor: "rgba(127, 235, 217, 0.08)",
      primaryTextColor: "#EDFFFE",
      primaryBorderColor: "#7FEBD9",
      lineColor: "#7FEBD9",
      secondaryColor: "rgba(245, 166, 35, 0.08)",
      secondaryBorderColor: "rgba(245, 166, 35, 0.5)",
      tertiaryColor: "rgba(255, 255, 255, 0.03)",
      clusterBkg: "rgba(255, 255, 255, 0.02)",
      clusterBorder: "rgba(255, 255, 255, 0.14)",
      edgeLabelBackground: "#03140F",
      fontFamily: '"Space Mono", ui-monospace, monospace',
      fontSize: "13px",
    },
    securityLevel: "strict",
  });
  initialized = true;
}

export default function MermaidImpl({ chart }: { chart: string }) {
  ensureInitialized();
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    mermaid.render(`mermaid-${rawId}`, chart).then(({ svg }) => {
      if (!cancelled) setSvg(svg);
    });
    return () => {
      cancelled = true;
    };
  }, [chart, rawId]);

  if (!svg) {
    return <div className="mermaid-diagram animate-pulse text-xs text-fog-faint">Rendering diagram...</div>;
  }

  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}
