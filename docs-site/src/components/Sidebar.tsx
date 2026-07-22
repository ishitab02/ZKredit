import { NavLink } from "react-router-dom";
import { SECTIONS } from "../lib/nav";
import { IconChip, IconCompass, IconLayers, IconList, IconStart } from "./Icons";

const SECTION_ICONS: Record<string, (props: { className?: string }) => JSX.Element> = {
  "Get Started": IconStart,
  Concepts: IconLayers,
  Architecture: IconChip,
  Guides: IconCompass,
  Reference: IconList,
};

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Docs navigation" className="flex flex-col gap-8 pb-16 pr-2">
      {SECTIONS.map((section) => {
        const Icon = SECTION_ICONS[section.title];
        return (
          <div key={section.title}>
            <h3 className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-fog-faint">
              {Icon && <Icon className="section-icon h-3.5 w-3.5 text-teal-bright" />}
              {section.title}
            </h3>
            <ul className="flex flex-col gap-0.5 border-l border-white/[0.07]">
              {section.pages.map((page) => (
                <li key={page.slug}>
                  <NavLink
                    to={`/${page.slug}`}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `glow-link block py-1.5 pl-4 pr-2 text-sm ${
                        isActive ? "is-active text-teal-bright" : "text-fog-muted hover:text-fog"
                      }`
                    }
                  >
                    {page.title}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
