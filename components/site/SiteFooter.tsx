import Link from "next/link";
import SpectorLogo from "@/components/brand/SpectorLogo";

const FOOTER_LINKS = [
  { label: "GitHub", href: "#" },
  { label: "Docs", href: "#" },
  { label: "Medium", href: "#" },
];

export default function SiteFooter() {
  return (
    <footer className="flex w-full justify-center border-t border-neutral-300 py-32">
      <div className="flex w-full max-w-content items-center px-24">
        <div className="flex flex-1">
          <SpectorLogo />
        </div>
        <nav className="flex gap-24">
          {FOOTER_LINKS.map(({ label, href }) => (
            <Link
              key={label}
              href={href}
              className="font-body text-body font-medium leading-sm text-neutral-700 hover:text-neutral-800"
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
