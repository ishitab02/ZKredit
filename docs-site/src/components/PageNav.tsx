import { Link } from "react-router-dom";
import type { DocPage } from "../lib/nav";
import { ArrowLeft, ArrowRight } from "./Icons";

export default function PageNav({ prev, next }: { prev?: DocPage; next?: DocPage }) {
  if (!prev && !next) return null;
  return (
    <div className="page-nav-divider mt-16 grid grid-cols-1 gap-3 pt-8 sm:grid-cols-2">
      {prev ? (
        <Link
          to={`/${prev.slug}`}
          className="surface group flex flex-col gap-1.5 px-5 py-4 transition-all duration-200 hover:border-teal-bright/30 hover:shadow-[0_0_26px_-10px_rgba(127,235,217,0.55)]"
        >
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-fog-faint">
            <ArrowLeft className="h-3 w-3" />
            Previous
          </span>
          <span className="font-display text-sm font-medium text-fog group-hover:text-teal-bright">
            {prev.title}
          </span>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link
          to={`/${next.slug}`}
          className="surface group flex flex-col items-end gap-1.5 px-5 py-4 text-right transition-all duration-200 hover:border-teal-bright/30 hover:shadow-[0_0_26px_-10px_rgba(127,235,217,0.55)]"
        >
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-fog-faint">
            Next
            <ArrowRight className="h-3 w-3" />
          </span>
          <span className="font-display text-sm font-medium text-fog group-hover:text-teal-bright">
            {next.title}
          </span>
        </Link>
      ) : (
        <div />
      )}
    </div>
  );
}
