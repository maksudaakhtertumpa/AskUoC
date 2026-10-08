"use client";

import { useState } from "react";
import { fmtInt } from "@/lib/admin";

/** Hand-rolled charts (no dependencies): CSS bars scale with the layout, SVG paths draw the sparkline. */

const shortDay = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function Sparkline({ values, label, className = "" }: { values: number[]; label: string; className?: string }) {
  const max = Math.max(1, ...values);
  const n = Math.max(1, values.length - 1);
  const pts = values.map((v, i) => [(i / n) * 100, 22 - (v / max) * 20] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className={`h-8 w-full overflow-visible ${className}`}
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#d33d8f" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#7f58b8" stopOpacity="0" />
        </linearGradient>
      </defs>
      {values.length > 1 && <path d={`${line} L100 24 L0 24 Z`} fill="url(#spark-fill)" />}
      <path
        d={line}
        fill="none"
        stroke="#7f58b8"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Chats per day. Tap, hover or focus a bar to read its value; a hidden table gives screen readers the same data. */
export function DayBars({ data }: { data: { day: string; chats: number }[] }) {
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.chats));
  const peak = data.reduce((b, d, i) => (d.chats > data[b].chats ? i : b), 0);
  const shown = sel ?? data.length - 1;
  const total = data.reduce((a, d) => a + d.chats, 0);
  if (!data.length) return null;
  return (
    <div>
      <p
        className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-slate-500 dark:text-slate-400"
        aria-hidden
      >
        <span>
          <span className="text-lg font-semibold tabular-nums text-uoc-900 dark:text-uoc-50">
            {fmtInt(data[shown].chats)}
          </span>{" "}
          chat{data[shown].chats === 1 ? "" : "s"} on {shortDay(data[shown].day)}
        </span>
        <span>
          {fmtInt(total)} in {data.length} days
          {total > 0 && (
            <>
              {" "}
              - peak {fmtInt(data[peak].chats)} on {shortDay(data[peak].day)}
            </>
          )}
        </span>
      </p>
      <div
        className="flex h-32 items-end gap-1 sm:gap-1.5"
        role="img"
        aria-label={`Chats per day for the last ${data.length} days. ${fmtInt(total)} in total.`}
        onMouseLeave={() => setSel(null)}
      >
        {data.map((d, i) => (
          <div
            key={d.day}
            tabIndex={0}
            onMouseEnter={() => setSel(i)}
            onFocus={() => setSel(i)}
            onBlur={() => setSel(null)}
            onClick={() => setSel(i)}
            className="group flex h-full min-w-0 flex-1 cursor-default flex-col justify-end rounded-md outline-none focus-visible:ring-2 focus-visible:ring-uoc-400"
          >
            <div
              className={`w-full rounded-t-md transition-all duration-300 ${i === shown ? "bg-gradient-to-t from-uoc-600 to-magenta-500" : "bg-uoc-300/70 dark:bg-uoc-500/50"}`}
              style={{ height: `${Math.max(d.chats ? 4 : 2, (d.chats / max) * 100)}%`, opacity: d.chats ? 1 : 0.35 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-slate-500 dark:text-slate-400" aria-hidden>
        <span>{shortDay(data[0].day)}</span>
        <span>{shortDay(data[Math.floor(data.length / 2)].day)}</span>
        <span>Today</span>
      </div>
      <table className="sr-only">
        <caption>Chats per day</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Chats</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>{d.chats}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const OUTCOME_STYLE: Record<string, { bar: string; dot: string; label: string }> = {
  answered: { bar: "bg-uoc-500", dot: "bg-uoc-500", label: "Answered" },
  fallback: { bar: "bg-amber-400", dot: "bg-amber-400", label: "Couldn't answer" },
  degraded: { bar: "bg-red-500", dot: "bg-red-500", label: "AI unavailable" },
};
const OTHER = { bar: "bg-slate-400", dot: "bg-slate-400", label: "" };

/** One stacked bar for the outcome split, with a labelled legend (colour is never the only cue). */
export function OutcomeBar({ outcomes }: { outcomes: Record<string, number> }) {
  const entries = Object.entries(outcomes)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (!total) return <p className="text-sm text-slate-500 dark:text-slate-400">No chats yet.</p>;
  return (
    <div>
      <div
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label={entries.map(([k, v]) => `${OUTCOME_STYLE[k]?.label ?? k}: ${v}`).join(", ")}
      >
        {entries.map(([k, v]) => (
          <div
            key={k}
            className={`${(OUTCOME_STYLE[k] ?? OTHER).bar} first:rounded-l-full last:rounded-r-full`}
            style={{ width: `${(v / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {entries.map(([k, v]) => {
          const s = OUTCOME_STYLE[k] ?? OTHER;
          return (
            <li key={k} className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${s.dot}`} />
              {s.label || k.replace(/_/g, " ")}
              <span className="font-semibold tabular-nums text-uoc-900 dark:text-uoc-50">{fmtInt(v)}</span>
              <span className="text-slate-400">({Math.round((v / total) * 100)}%)</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Thin horizontal meter for a 0-1 ratio. */
export function RatioBar({
  ratio,
  label,
  tone = "brand",
}: {
  ratio: number | null;
  label: string;
  tone?: "brand" | "good" | "warn" | "bad";
}) {
  const fill = {
    brand: "bg-gradient-to-r from-uoc-500 to-magenta-500",
    good: "bg-emerald-500",
    warn: "bg-amber-400",
    bad: "bg-red-500",
  }[tone];
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={ratio == null ? undefined : Math.round(ratio * 100)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-uoc-100 dark:bg-white/10"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${fill}`}
        style={{ width: `${Math.round((ratio ?? 0) * 100)}%` }}
      />
    </div>
  );
}
