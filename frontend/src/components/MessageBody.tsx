"use client";

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Source } from "@/lib/api";
import { citationNumbers } from "@/lib/citations";

/** Only http(s), mailto/tel and citation links survive; javascript:/data: etc. are dropped (shared pages show other people's text). */
function safeUrl(url: string): string {
  return /^(https?:|mailto:|tel:|cite:|#|\/)/i.test(url.trim()) ? url : "";
}

/** Models write <br> for line breaks in table cells; raw HTML stays disabled, so turn just that tag into a real break. */
function withBreaks(children: ReactNode): ReactNode {
  const parts = Array.isArray(children) ? children : [children];
  return parts.flatMap((child, i) =>
    typeof child === "string" && /<br\s*\/?>/i.test(child)
      ? child.split(/<br\s*\/?>/i).flatMap((piece, j) => (j === 0 ? [piece] : [<br key={`${i}-${j}`} />, piece]))
      : [child],
  );
}

/** Renders assistant markdown; turns [n] citations into links to the matching source. */
export default function MessageBody({ text, sources }: { text: string; sources: Source[] }) {
  const shown = citationNumbers(text, sources);
  const withCites = text.replace(/\[(\d+)\]/g, (m, n) =>
    shown.has(Number(n)) ? `[${shown.get(Number(n))}](cite:${n})` : m,
  );
  return (
    <div className="prose prose-slate max-w-none text-[15px] leading-7 dark:prose-invert prose-headings:font-semibold prose-table:text-sm prose-a:text-uoc-600 dark:prose-a:text-uoc-300 prose-p:my-3 prose-li:my-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={safeUrl}
        components={{
          a({ href, children }) {
            if (href?.startsWith("cite:")) {
              const src = sources.find((s) => s.n === Number(href.slice(5)));
              return (
                <a
                  href={src?.url}
                  target="_blank"
                  rel="noreferrer"
                  title={src?.title}
                  className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-uoc-100 px-1 align-super text-[10px] font-semibold text-uoc-700 no-underline hover:bg-uoc-200 dark:bg-uoc-900 dark:text-uoc-200"
                >
                  {children}
                </a>
              );
            }
            if (!href) return <span>{children}</span>; // blocked scheme becomes plain text
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          p: ({ children }) => <p>{withBreaks(children)}</p>,
          li: ({ children }) => <li>{withBreaks(children)}</li>,
          td: ({ children }) => <td>{withBreaks(children)}</td>,
          th: ({ children }) => <th>{withBreaks(children)}</th>,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="!my-0">{children}</table>
            </div>
          ),
        }}
      >
        {withCites}
      </ReactMarkdown>
    </div>
  );
}
