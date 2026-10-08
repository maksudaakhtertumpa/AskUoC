"use client";

import {
  Brain,
  Database,
  Gauge,
  ListFilter,
  MessageSquareText,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Trace } from "@/lib/api";

const STEP: Record<string, { label: string; Icon: LucideIcon }> = {
  route: { label: "Understood the question", Icon: Route },
  rewrite: { label: "Made it standalone", Icon: MessageSquareText },
  retrieve: { label: "Searched the knowledge base", Icon: Search },
  rerank: { label: "Ranked the passages", Icon: ListFilter },
  grade: { label: "Checked relevance", Icon: ShieldCheck },
  broaden: { label: "Retried with keywords", Icon: Search },
  generate: { label: "Wrote the answer", Icon: Brain },
  fallback: { label: "No good match found", Icon: Sparkles },
  chitchat: { label: "Small talk", Icon: Sparkles },
  answer_cache: { label: "Served from the answer cache", Icon: Zap },
};

type Info = Record<string, unknown>;

function describe(node: string, info: Info = {}): string {
  const n = (k: string) => info[k] as number | undefined;
  switch (node) {
    case "route":
      return info.route === "chitchat"
        ? "Looks like a greeting - no search needed."
        : "A real question about the university.";
    case "rewrite":
      return info.rewritten
        ? `Rewritten using ${String(info.by)}: “${String(info.query)}”`
        : "Already clear - used as is.";
    case "retrieve":
      return `${n("candidates") ?? 0} candidate passages (hybrid: meaning + keywords)${info.cache === "hit" ? " · from cache" : ""}${info.embedding_fallback ? " · keyword-only, embedding service was unavailable" : ""}.`;
    case "rerank": {
      const top = (info.passages as { title: string }[] | undefined)?.[0]?.title;
      return top ? `Best match: ${top}` : "Reordered by title and query coverage.";
    }
    case "grade":
      return info.relevant
        ? `Relevant enough (query coverage ${Math.round(((n("best_coverage") ?? 0) as number) * 100)}%).`
        : "Not relevant enough to answer from.";
    case "broaden":
      return String(info.reason ?? "Broadened the search once.");
    case "generate":
      return `Used ${n("passages_used") ?? 0} passages to write ${n("chars") ?? 0} characters.`;
    case "fallback":
      return "Said so honestly instead of guessing, and pointed to the university.";
    case "answer_cache":
      return "An identical earlier question was answered with the same data and settings.";
    default:
      return "";
  }
}

/** "How this was answered": the LangGraph run as a small timeline. */
export default function Insights({ trace }: { trace: Trace }) {
  const steps = trace.steps.filter((s) => STEP[s.node]);
  const total = trace.total_ms ?? steps.reduce((a, s) => a + s.ms, 0);
  const max = Math.max(1, ...steps.map((s) => s.ms));
  return (
    <div
      className="glass mt-2 animate-rise rounded-2xl p-3 text-xs sm:p-4"
      role="region"
      aria-label="How this answer was produced"
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5 font-semibold text-uoc-700 dark:text-uoc-200">
          <Gauge className="h-3.5 w-3.5" /> How this was answered
        </span>
        <span className="flex items-center gap-2">
          {trace.cache?.answer === "hit" && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              cache hit
            </span>
          )}
          <span className="tabular-nums">
            {total >= 1000 ? `${(total / 1000).toFixed(1)} s` : `${Math.round(total)} ms`}
          </span>
        </span>
      </div>
      <ol className="space-y-2">
        {steps.map((s, i) => {
          const { label, Icon } = STEP[s.node];
          return (
            <li key={`${s.node}-${i}`} className="flex gap-2.5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-uoc-100 text-uoc-600 dark:bg-uoc-800 dark:text-uoc-200">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-700 dark:text-slate-200">{label}</span>
                  <span className="shrink-0 tabular-nums text-slate-400">{Math.round(s.ms)} ms</span>
                </div>
                <p className="break-words text-slate-500 dark:text-slate-400">{describe(s.node, s.info)}</p>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-uoc-100/70 dark:bg-white/10" aria-hidden>
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-uoc-500 to-magenta-500"
                    style={{ width: `${Math.max(3, (s.ms / max) * 100)}%` }}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
        <Database className="h-3 w-3" /> Answers use only the university&apos;s published pages - nothing here is stored
        beyond your own chat.
      </p>
    </div>
  );
}
