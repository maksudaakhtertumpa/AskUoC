import type { ReactNode } from "react";
import { DISCLAIMER, LEGAL_UPDATED, formatDate } from "@/lib/site";
import LegalLinks from "./LegalLinks";
import SiteHeader from "./SiteHeader";

export type LegalSection = { id: string; title: string; body: ReactNode };

/** Shared shell for the info pages: header, table of contents, article, last-updated date and footer links. */
export default function LegalPage({
  title,
  intro,
  sections,
  updated = LEGAL_UPDATED,
  showDisclaimer = true,
}: {
  title: string;
  intro?: ReactNode;
  sections: LegalSection[];
  updated?: string | null;
  showDisclaimer?: boolean;
}) {
  const toc = (
    <ol className="space-y-0.5 text-sm">
      {sections.map((s, i) => (
        <li key={s.id}>
          <a
            href={`#${s.id}`}
            className="flex min-h-9 items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-slate-600 transition hover:bg-uoc-600/10 hover:text-uoc-800 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <span className="w-4 shrink-0 text-right text-xs tabular-nums text-uoc-500 dark:text-uoc-300" aria-hidden>
              {i + 1}
            </span>
            {s.title}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="app-bg min-h-dvh text-slate-900 dark:text-slate-100">
      {/* the chat locks html/body to the viewport height; let long pages print in full */}
      <style>{`@media print{html,body{height:auto!important;overflow:visible!important}.app-bg{background:#fff!important}.legal-card{background:none!important;box-shadow:none!important;border:0!important;backdrop-filter:none!important;color:#000}a[href^="http"]::after{content:" (" attr(href) ")";font-size:.8em;word-break:break-all}}`}</style>
      <SiteHeader />
      <div className="mx-auto max-w-5xl gap-10 px-4 pb-6 pt-6 sm:pt-10 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden lg:block print:hidden">
          <nav aria-label="On this page" className="sticky top-24">
            <p className="mb-2 px-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              On this page
            </p>
            {toc}
          </nav>
        </aside>

        <main id="main" className="min-w-0">
          <article className="legal-card glass-strong rounded-3xl px-5 py-7 sm:px-10 sm:py-10">
            <h1 className="text-3xl font-semibold tracking-tight text-uoc-900 sm:text-4xl dark:text-white">{title}</h1>
            {updated && (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Last updated <time dateTime={updated}>{formatDate(updated)}</time>
              </p>
            )}
            {intro && (
              <div className="mt-5 text-base leading-relaxed text-slate-700 dark:text-slate-300 [&_a]:font-medium [&_a]:text-uoc-600 [&_a]:underline [&_a]:underline-offset-2 dark:[&_a]:text-uoc-300">
                {intro}
              </div>
            )}

            <details className="group mt-6 rounded-2xl border border-uoc-200/70 bg-white/40 lg:hidden print:hidden dark:border-white/10 dark:bg-white/5">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold text-uoc-800 dark:text-uoc-100">
                On this page
                <span aria-hidden className="text-xs text-slate-400 transition group-open:rotate-180">
                  ▼
                </span>
              </summary>
              <nav aria-label="On this page (mobile)" className="px-2 pb-2">
                {toc}
              </nav>
            </details>

            <div className="mt-8 space-y-10">
              {sections.map((s, i) => (
                <section key={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-24" id={s.id}>
                  <h2
                    id={`${s.id}-h`}
                    className="mb-3 text-xl font-semibold tracking-tight text-uoc-900 dark:text-white"
                  >
                    <span className="mr-2 text-uoc-400 tabular-nums dark:text-uoc-400" aria-hidden>
                      {i + 1}.
                    </span>
                    {s.title}
                  </h2>
                  <div className="prose prose-slate max-w-none prose-a:font-medium prose-a:text-uoc-600 prose-a:underline-offset-2 hover:prose-a:text-magenta-600 prose-h3:mt-6 prose-h3:text-base prose-li:my-1 prose-table:text-sm dark:prose-invert dark:prose-a:text-uoc-300 dark:hover:prose-a:text-magenta-300">
                    {s.body}
                  </div>
                </section>
              ))}
            </div>

            {showDisclaimer && (
              <aside
                aria-label="Disclaimer"
                className="mt-12 rounded-2xl border border-magenta-200/70 bg-magenta-50/70 px-4 py-3.5 text-sm leading-relaxed text-magenta-900 dark:border-magenta-400/20 dark:bg-magenta-500/10 dark:text-magenta-100"
              >
                {DISCLAIMER}
              </aside>
            )}
          </article>
        </main>
      </div>
      <footer className="px-4 pb-8 pt-2 print:hidden">
        <LegalLinks size="md" />
      </footer>
    </div>
  );
}
