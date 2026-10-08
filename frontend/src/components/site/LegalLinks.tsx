import Link from "next/link";
import { INFO_PAGES } from "@/lib/site";

/** Links to the info pages; `sm` matches the 11px chat footer, `md` is for standalone pages. */
export default function LegalLinks({ size = "sm", className = "" }: { size?: "xs" | "sm" | "md"; className?: string }) {
  const text = size === "xs" ? "text-[10.5px]" : size === "sm" ? "text-[11px]" : "text-sm";
  const pad = size === "xs" ? "px-1" : "px-1.5";
  return (
    <nav aria-label="Legal and information" className={className}>
      <ul className={`flex flex-wrap items-center justify-center gap-x-0 gap-y-0 ${text}`}>
        {INFO_PAGES.map((p, i) => (
          <li key={p.href} className="flex items-center">
            {i > 0 && (
              <span aria-hidden className="text-slate-300 dark:text-slate-600">
                ·
              </span>
            )}
            <Link
              href={p.href}
              className={`inline-flex min-h-8 items-center whitespace-nowrap rounded-md ${pad} font-medium text-slate-500 underline-offset-2 transition hover:text-magenta-600 hover:underline dark:text-slate-400 dark:hover:text-magenta-300`}
            >
              {p.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
