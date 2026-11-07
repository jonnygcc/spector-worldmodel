import SpectorLogo from "@/components/brand/SpectorLogo";
import { EXTERNAL_LINK, SITE_LINKS } from "./links";

const FOOTER_LINKS = [SITE_LINKS.github, SITE_LINKS.docs, SITE_LINKS.medium];

export default function SiteFooter() {
  return (
    <footer className="flex w-full justify-center border-t border-neutral-300 py-32">
      <div className="flex w-full max-w-content items-center px-24">
        <div className="flex flex-1">
          <SpectorLogo />
        </div>
        <nav className="flex gap-24">
          {FOOTER_LINKS.map(({ label, href }) => (
            <a
              key={label}
              href={href}
              {...EXTERNAL_LINK}
              className="font-body text-body font-medium leading-sm text-neutral-700 hover:text-neutral-800"
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
