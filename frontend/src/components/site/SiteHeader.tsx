import { ArrowLeft, GraduationCap } from "lucide-react";
import Link from "next/link";

/** Slim header for standalone pages: brand on the left, link back to the chat on the right. */
export default function SiteHeader() {
  return (
    <header className="glass sticky top-0 z-20 rounded-none border-x-0 border-t-0 pt-[env(safe-area-inset-top)] print:hidden">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
        <Link href="/" className="flex min-h-11 items-center gap-2 font-semibold text-uoc-800 dark:text-uoc-100">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-uoc-600 to-magenta-500 text-white shadow-md shadow-uoc-600/25">
            <GraduationCap className="h-4 w-4" aria-hidden />
          </span>
          AskUoC
        </Link>
        <Link
          href="/"
          className="flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-uoc-700 transition hover:bg-uoc-600/10 hover:text-magenta-600 dark:text-uoc-200 dark:hover:bg-white/10 dark:hover:text-magenta-300"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to chat
        </Link>
      </div>
    </header>
  );
}
