import type { ReactNode } from "react";

/** Responsive table that scrolls sideways inside its own box on phones. */
export default function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="not-prose my-5 overflow-x-auto [overflow-wrap:normal] rounded-2xl border border-uoc-200/70 bg-white/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-uoc-500 dark:border-white/10 dark:bg-white/[0.03]"
    >
      <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-uoc-100/70 text-uoc-900 dark:bg-white/[0.07] dark:text-uoc-100">
            {head.map((h) => (
              <th key={h} scope="col" className="px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-slate-700 dark:text-slate-300">
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-uoc-200/60 align-top dark:border-white/10">
              {r.map((c, j) =>
                j === 0 ? (
                  <th
                    key={j}
                    scope="row"
                    className="min-w-[8.5rem] px-3.5 py-3 font-semibold text-slate-900 dark:text-slate-100"
                  >
                    {c}
                  </th>
                ) : (
                  <td key={j} className="px-3.5 py-3">
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
