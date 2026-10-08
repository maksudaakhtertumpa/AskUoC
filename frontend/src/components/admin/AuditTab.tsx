"use client";

import { History, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import Avatar from "@/components/ui/Avatar";
import { fmtInt, fullTime, getAudit, humanize, relTime, type AuditEvent } from "@/lib/admin";
import {
  Card,
  Chip,
  EmptyState,
  Note,
  SectionTitle,
  Skeleton,
  btnSecondary,
  inputCls,
  useNow,
  useResource,
  type Tone,
} from "./ui";

const AREA_TONE: Record<string, Tone> = {
  settings: "brand",
  user: "info",
  document: "warn",
  data: "good",
  snapshot: "warn",
};

function detailChips(d: AuditEvent["detail"]): { k: string; v: string }[] {
  return Object.entries(d ?? {}).map(([k, v]) => ({
    k: k.replace(/_/g, " "),
    v: Array.isArray(v) ? v.join(", ") || "-" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v),
  }));
}

const dayKey = (ts: string) => new Date(ts).toDateString();
function dayLabel(ts: string, now: number): string {
  const d = new Date(ts);
  const today = new Date(now).toDateString();
  if (d.toDateString() === today) return "Today";
  if (d.toDateString() === new Date(now - 86_400_000).toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

export default function AuditTab() {
  const res = useResource(getAudit);
  const now = useNow(30_000);
  const [q, setQ] = useState("");
  const [area, setArea] = useState("");
  const events = res.data;

  const areas = useMemo(() => [...new Set((events ?? []).map((e) => e.action.split(".")[0]))].sort(), [events]);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (events ?? []).filter(
      (e) =>
        (!area || e.action.startsWith(`${area}.`)) &&
        (!n || `${e.actor} ${e.action} ${JSON.stringify(e.detail ?? {})}`.toLowerCase().includes(n)),
    );
  }, [events, q, area]);

  const groups = useMemo(() => {
    const out: { key: string; ts: string; items: AuditEvent[] }[] = [];
    for (const e of filtered) {
      const k = dayKey(e.ts);
      const last = out[out.length - 1];
      if (last?.key === k) last.items.push(e);
      else out.push({ key: k, ts: e.ts, items: [e] });
    }
    return out;
  }, [filtered]);

  return (
    <Card aria-labelledby="audit-title">
      <SectionTitle
        id="audit-title"
        icon={<History aria-hidden className="h-4 w-4" />}
        title="Audit log"
        hint={
          events
            ? `Latest ${fmtInt(events.length)} admin actions, newest first. Secrets are never recorded.`
            : "Who changed what, and when"
        }
        actions={
          <button
            onClick={() => void res.reload()}
            disabled={res.refreshing}
            className={btnSecondary}
            aria-label="Refresh audit log"
          >
            <RefreshCw aria-hidden className={`h-4 w-4 ${res.refreshing ? "animate-spin" : ""}`} /> Refresh
          </button>
        }
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            aria-label="Filter events"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by person, action or detail"
            className={`${inputCls} pl-10`}
          />
        </div>
        <select
          aria-label="Filter by area"
          value={area}
          onChange={(e) => setArea(e.target.value)}
          className={`${inputCls} sm:w-44`}
        >
          <option value="">All areas</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {humanize(a)}
            </option>
          ))}
        </select>
      </div>

      {res.loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : res.error && !events ? (
        <Note
          kind="error"
          title="Couldn't load the audit log"
          action={
            <button className={btnSecondary} onClick={() => void res.reload()}>
              Try again
            </button>
          }
        >
          {res.error.message}
        </Note>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<History className="h-6 w-6" />}
          title={events?.length ? "No events match" : "Nothing recorded yet"}
        >
          {events?.length
            ? "Try a different filter."
            : "Admin actions like saving settings or uploading data will show up here."}
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.key} aria-label={dayLabel(g.ts, now)}>
              <h3 className="sticky top-0 z-10 -mx-1 mb-1 px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 backdrop-blur-md dark:text-slate-400">
                {dayLabel(g.ts, now)}
              </h3>
              <ol className="divide-y divide-uoc-100/70 dark:divide-white/10">
                {g.items.map((e, i) => {
                  const [areaName, verb = ""] = e.action.split(".");
                  const chips = detailChips(e.detail);
                  return (
                    <li key={`${e.ts}-${i}`} className="flex gap-3 py-3">
                      <Avatar user={{ username: e.actor, display_name: e.actor }} size={32} className="mt-0.5" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <span className="font-semibold">{e.actor}</span>
                          <Chip tone={verb === "delete" ? "bad" : (AREA_TONE[areaName] ?? "neutral")} title={e.action}>
                            {humanize(areaName)}
                            {verb && <> - {verb.replace(/_/g, " ")}</>}
                          </Chip>
                          <time
                            dateTime={e.ts}
                            title={fullTime(e.ts)}
                            className="ml-auto shrink-0 text-xs text-slate-500 dark:text-slate-400"
                          >
                            {relTime(e.ts, now)}
                          </time>
                        </p>
                        {chips.length > 0 && (
                          <ul className="flex flex-wrap gap-1.5" aria-label="Details">
                            {chips.map((c) => (
                              <li key={c.k} className="max-w-full">
                                <span
                                  title={`${c.k}: ${c.v}`}
                                  className="flex max-w-full items-center gap-1 rounded-lg bg-white/60 px-2 py-0.5 text-[11px] dark:bg-white/5"
                                >
                                  <span className="shrink-0 text-slate-500 dark:text-slate-400">{c.k}</span>
                                  <span className="truncate font-mono">{c.v}</span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
