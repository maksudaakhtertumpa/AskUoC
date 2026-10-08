"use client";

import { MessageSquare, Search, SquarePen } from "lucide-react";
import { useMemo, useState } from "react";
import type { Conversation } from "@/lib/history";

type Props = { convs: Conversation[]; onClose: () => void; onSelect: (id: string) => void; onNew: () => void };
type Result = { conv: Conversation; snippet: string | null };

const WINDOW = 46;

function findSnippet(c: Conversation, q: string): string | null {
  const needle = q.toLowerCase();
  for (const m of c.messages) {
    const at = m.content.toLowerCase().indexOf(needle);
    if (at >= 0) {
      const from = Math.max(0, at - WINDOW);
      const text = m.content.slice(from, at + q.length + WINDOW).replace(/\s+/g, " ");
      return (from > 0 ? "…" : "") + text + (at + q.length + WINDOW < m.content.length ? "…" : "");
    }
  }
  return null;
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-amber-200/80 px-0.5 text-inherit dark:bg-amber-400/30">
        {text.slice(at, at + q.length)}
      </mark>
      {text.slice(at + q.length)}
    </>
  );
}

/** Ctrl/Cmd+K palette: searches conversation titles and message text. */
export default function SearchDialog({ convs, onClose, onSelect, onNew }: Props) {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const term = q.trim();

  const results: Result[] = useMemo(() => {
    const sorted = [...convs].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!term) return sorted.slice(0, 8).map((conv) => ({ conv, snippet: null }));
    return sorted
      .map((conv) => ({
        conv,
        snippet: findSnippet(conv, term),
        inTitle: conv.title.toLowerCase().includes(term.toLowerCase()),
      }))
      .filter((r) => r.snippet || r.inTitle)
      .map(({ conv, snippet }) => ({ conv, snippet }));
  }, [convs, term]);

  const rows = results.length + 1; // row 0 is "New chat"
  const pick = (i: number) => {
    if (i === 0) onNew();
    else onSelect(results[i - 1].conv.id);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center sm:p-4 sm:pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Search chats"
    >
      <div
        className="absolute inset-0 animate-[fade_0.15s_ease-out] bg-slate-950/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div className="glass-strong relative flex h-dvh w-full max-w-xl animate-pop flex-col overflow-hidden sm:h-auto sm:rounded-2xl">
        <div className="flex items-center gap-3 border-b border-uoc-100 px-4 pt-[env(safe-area-inset-top)] dark:border-uoc-800">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => (c + 1) % rows);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => (c - 1 + rows) % rows);
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(cursor);
              }
            }}
            placeholder="Search chats…"
            aria-label="Search chats"
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-slate-400 sm:text-sm"
          />
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1.5 text-xs font-medium text-uoc-600 sm:hidden dark:text-uoc-300"
          >
            Cancel
          </button>
          <kbd className="hidden rounded-md border border-uoc-100 px-1.5 py-0.5 text-[10px] text-slate-400 sm:block dark:border-uoc-800">
            Esc
          </kbd>
        </div>

        <ul className="flex-1 overflow-y-auto p-2 sm:max-h-[50vh] sm:flex-none" role="listbox">
          <li role="option" aria-selected={cursor === 0}>
            <button
              onClick={() => pick(0)}
              onMouseEnter={() => setCursor(0)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm ${cursor === 0 ? "bg-slate-100 dark:bg-slate-800" : ""}`}
            >
              <SquarePen className="h-4 w-4 text-slate-500" /> New chat
            </button>
          </li>
          {!term && results.length > 0 && <li className="px-3 pb-1 pt-3 text-xs text-slate-400">Recent</li>}
          {results.map((r, i) => (
            <li key={r.conv.id} role="option" aria-selected={cursor === i + 1}>
              <button
                onClick={() => pick(i + 1)}
                onMouseEnter={() => setCursor(i + 1)}
                className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left ${cursor === i + 1 ? "bg-slate-100 dark:bg-slate-800" : ""}`}
              >
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm">
                    <span className="truncate">
                      <Highlight text={r.conv.title} q={term} />
                    </span>
                    {r.conv.archived && (
                      <span className="shrink-0 rounded-full bg-uoc-100 px-1.5 py-0.5 text-[10px] font-medium text-uoc-700 dark:bg-uoc-800 dark:text-uoc-200">
                        Archived
                      </span>
                    )}
                  </span>
                  {r.snippet && (
                    <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
                      <Highlight text={r.snippet} q={term} />
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
          {term && results.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-slate-400">No chats match “{term}”.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
