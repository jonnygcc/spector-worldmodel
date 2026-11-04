import Link from "next/link";
import { ChevronLeft, Globe } from "lucide-react";
import MetaList, { type MetaItem } from "./MetaList";

// With `onBack` the back control is a button inside the same screen (real analysis);
// without it, a link to "/" (preview).
export default function ReportHeader({
  url,
  goal,
  meta,
  onBack,
}: {
  url: string;
  goal: string;
  meta: MetaItem[];
  onBack?: () => void;
}) {
  const back = (
    <>
      <ChevronLeft aria-hidden="true" className="size-16 shrink-0" />
      Back to home
    </>
  );
  const backClass =
    "flex cursor-pointer items-center gap-4 font-heading text-label font-medium uppercase leading-rg tracking-wide text-neutral-800";

  return (
    <>
      {onBack ? (
        <button type="button" onClick={onBack} className={backClass}>
          {back}
        </button>
      ) : (
        <Link href="/" className={backClass}>
          {back}
        </Link>
      )}

      {/* Title is h3 on mobile, h1 from lg. */}
      <div className="flex w-full flex-col items-start gap-12 lg:gap-16">
        <span className="flex max-w-full items-center gap-8 break-all rounded-sm border border-success bg-neutral-100 py-4 pl-4 pr-8 font-heading text-label font-medium leading-rg tracking-wide text-success">
          <Globe aria-hidden="true" className="size-16 shrink-0" />
          {url}
        </span>
        <div className="flex flex-col items-start gap-8">
          <h1 className="font-heading text-h3 font-medium leading-rg tracking-tight text-neutral-800 lg:text-h1">
            {goal}
          </h1>
          <MetaList items={meta} />
        </div>
      </div>
    </>
  );
}
