import {
  Award,
  CalendarDays,
  ExternalLink,
  FileText,
  GraduationCap,
  MessageSquareQuote,
  Newspaper,
  type LucideIcon,
} from "lucide-react";
import type { Source } from "@/lib/api";
import { citationNumbers } from "@/lib/citations";

const KIND: Record<string, { label: string; Icon: LucideIcon; tone: string }> = {
  programme: {
    label: "Programme",
    Icon: GraduationCap,
    tone: "bg-uoc-50 text-uoc-700 dark:bg-uoc-950 dark:text-uoc-300",
  },
  funding: {
    label: "Scholarship",
    Icon: Award,
    tone: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  },
  page: { label: "Page", Icon: FileText, tone: "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300" },
  pdf: {
    label: "PDF",
    Icon: FileText,
    tone: "bg-magenta-50 text-magenta-700 dark:bg-magenta-950 dark:text-magenta-300",
  },
  post: { label: "News", Icon: Newspaper, tone: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300" },
  tribe_events: {
    label: "Event",
    Icon: CalendarDays,
    tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
  testimonials: {
    label: "Story",
    Icon: MessageSquareQuote,
    tone: "bg-magenta-50 text-magenta-700 dark:bg-magenta-950 dark:text-magenta-300",
  },
};

/** Sources the answer cited; if none were cited inline, the top three. */
export default function Sources({ text, sources }: { text: string; sources: Source[] }) {
  if (!sources.length) return null;
  const display = citationNumbers(text, sources);
  const cited = new Set(display.keys());
  const picked = cited.size ? sources.filter((s) => cited.has(s.n)) : sources.slice(0, 3);
  // one chip per document, carrying every citation number that points at it
  const shown: (Source & { nums: number[] })[] = [];
  for (const [i, s] of picked.entries()) {
    const num = display.get(s.n) ?? i + 1; // nothing cited inline: number the top three in order
    const same = shown.find((x) => x.url === s.url);
    if (same) same.nums.push(num);
    else shown.push({ ...s, nums: [num] });
  }
  shown.sort((a, b) => a.nums[0] - b.nums[0]);
  if (!shown.length) return null;
  return (
    <div className="mt-3" aria-label="Sources">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">Sources</p>
      <div className="flex flex-wrap gap-2">
        {shown.map((s, i) => {
          const k = KIND[s.doc_type] ?? KIND.page;
          const style = { animationDelay: `${i * 70}ms` };
          const chip =
            "glass group flex max-w-full animate-rise items-center gap-2 rounded-xl py-1 pl-1 pr-2.5 text-xs text-slate-600 dark:text-slate-300";
          const icon = (
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${k.tone}`}>
              <k.Icon className="h-3.5 w-3.5" />
            </span>
          );
          const numbers = (
            <span className="flex shrink-0 gap-0.5">
              {s.nums.map((n) => (
                <span
                  key={n}
                  className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-uoc-100 px-1 text-[10px] font-semibold text-uoc-700 dark:bg-uoc-900 dark:text-uoc-200"
                >
                  {n}
                </span>
              ))}
            </span>
          );
          // admin-uploaded documents (upload://) have no public URL
          if (!/^https?:\/\//i.test(s.url)) {
            return (
              <span key={s.url} title={s.snippet} style={style} className={chip}>
                {icon}
                <span className="truncate">{s.title}</span>
                {numbers}
                <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-500 dark:bg-white/10">
                  uploaded
                </span>
              </span>
            );
          }
          return (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              title={s.snippet}
              style={style}
              className={`${chip} transition hover:-translate-y-0.5 hover:text-uoc-700`}
            >
              {icon}
              <span className="truncate">{s.title}</span>
              {numbers}
              <ExternalLink className="h-3 w-3 shrink-0 opacity-40 transition group-hover:opacity-100" />
            </a>
          );
        })}
      </div>
    </div>
  );
}
