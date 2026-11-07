import Link from "next/link";
import SpectorLogo from "@/components/brand/SpectorLogo";
import { EXTERNAL_LINK, SITE_LINKS } from "./links";

const NAV_LINKS = [SITE_LINKS.docs, SITE_LINKS.medium];

export default function SiteHeader() {
  return (
    <header className="flex w-full justify-center border-b border-neutral-300 py-24">
      <div className="flex w-full max-w-content items-center px-24">
        <Link href="/" className="flex flex-1 items-center gap-8">
          <SpectorLogo />
          <span className="font-heading text-h5 font-medium leading-rg text-neutral-800">
            Spector
          </span>
        </Link>
        <nav className="flex items-center gap-24">
          {NAV_LINKS.map(({ label, href }) => (
            <a
              key={label}
              href={href}
              {...EXTERNAL_LINK}
              className="font-body text-small font-medium leading-sm text-neutral-700 hover:text-neutral-800 lg:text-body"
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
