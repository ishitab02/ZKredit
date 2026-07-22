import { Link } from "react-router-dom";
import { GITHUB_URL, MAIN_SITE_URL } from "../lib/site";
import { Github, Menu, Close } from "./Icons";

export default function Header({
  menuOpen,
  onToggleMenu,
}: {
  menuOpen: boolean;
  onToggleMenu: () => void;
}) {
  return (
    <header className="fixed inset-x-0 top-0 z-[100]">
      <div className="container-page pt-3 md:pt-4">
        <nav className="glass flex h-14 items-center justify-between rounded-2xl pl-3 pr-3 md:h-16 md:pl-4 md:pr-4">
          <div className="flex items-center gap-3 md:gap-4">
            <button
              type="button"
              onClick={onToggleMenu}
              className="icon-btn h-9 w-9 text-fog lg:hidden"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
            >
              {menuOpen ? <Close className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>

            <a
              href={MAIN_SITE_URL}
              className="flex items-center gap-2.5 text-fog transition-colors hover:text-teal-bright"
              aria-label="ZKredit home"
            >
              <img
                src="/brand/zkredit-mark.svg"
                alt=""
                className="h-8 w-8 object-contain md:h-9 md:w-9"
                width={36}
                height={36}
              />
              <span className="hidden font-display text-xl font-semibold tracking-tight sm:inline md:text-2xl">
                ZKredit
              </span>
            </a>

            <Link to="/" className="eyebrow-pill hover:border-teal-bright/40 hover:text-fog">
              Docs
            </Link>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className="icon-btn h-9 w-9"
            >
              <Github className="h-4 w-4" />
            </a>
            <a href={MAIN_SITE_URL} className="btn-ghost !px-4 !py-2 text-xs">
              Launch app
            </a>
          </div>
        </nav>
      </div>
    </header>
  );
}
