import { useEffect, useState } from "react";

interface Heading {
  id: string;
  text: string;
  level: number;
}

export default function TableOfContents({ pageKey }: { pageKey: string }) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(".docs-prose h2, .docs-prose h3"),
    );
    setHeadings(
      nodes.map((n) => ({
        id: n.id,
        text: n.textContent ?? "",
        level: n.tagName === "H2" ? 2 : 3,
      })),
    );
    setActiveId("");
  }, [pageKey]);

  useEffect(() => {
    if (headings.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-96px 0px -70% 0px", threshold: 1 },
    );
    headings.forEach((h) => {
      const el = document.getElementById(h.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <nav
      aria-label="On this page"
      className="sticky top-28 hidden max-h-[calc(100vh-8rem)] w-56 shrink-0 overflow-y-auto pb-16 xl:block"
    >
      <h3 className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-fog-faint">
        On this page
      </h3>
      <ul className="flex flex-col gap-1 border-l border-white/[0.07]">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={`glow-link block py-1 text-[13px] leading-snug ${
                activeId === h.id ? "is-active text-teal-bright" : "text-fog-faint hover:text-fog-muted"
              }`}
              style={{ paddingLeft: h.level === 3 ? "1.75rem" : "1rem" }}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
