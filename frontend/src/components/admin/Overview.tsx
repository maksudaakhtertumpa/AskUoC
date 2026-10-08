"use client";

import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Database,
  Eye,
  HardDrive,
  MessageSquare,
  RefreshCw,
  Search,
  ThumbsDown,
  ThumbsUp,
  Timer,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  fmtDuration,
  fmtInt,
  fmtMs,
  fmtPct,
  fullTime,
  getDocuments,
  getStats,
  humanize,
  relTime,
  type ProviderName,
  type ProviderState,
  type Stats,
} from "@/lib/admin";
import { DayBars, OutcomeBar, RatioBar, Sparkline } from "./charts";
import {
  Card,
  Chip,
  EmptyState,
  Note,
  SectionTitle,
  Skeleton,
  btnPrimary,
  btnSecondary,
  useNow,
  useResource,
  type Tone,
} from "./ui";
import type { TabId } from "./tabs";

const POLL_MS = 15_000;
const PROVIDERS: { id: ProviderName; label: string; icon: ReactNode }[] = [
  { id: "llm", label: "Language model", icon: <BrainCircuit className="h-4 w-4" /> },
  { id: "embedding", label: "Embeddings", icon: <Search className="h-4 w-4" /> },
  { id: "vision", label: "Vision (image reading)", icon: <Eye className="h-4 w-4" /> },
];
/** Errors an admin must act on (vs. transient ones that clear themselves). */
const NEEDS_ACTION = new Set(["auth", "not_found", "quota"]);
const KIND_LABEL: Record<string, string> = {
  quota: "Usage limit reached",
  rate_limit: "Rate limited",
  auth: "API key rejected",
  not_found: "Model or endpoint not found",
  timeout: "Timed out",
  unavailable: "Service unavailable",
  content_blocked: "Content blocked",
  unknown: "Unknown error",
};

function Kpi({
  icon,
  label,
  value,
  sub,
  children,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  tone?: "warn" | "bad";
}) {
  const valueTone =
    tone === "bad"
      ? "text-red-600 dark:text-red-300"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-300"
        : "text-uoc-900 dark:text-uoc-50";
  return (
    <div className="glass flex min-w-0 flex-col gap-1 rounded-3xl p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
        <span aria-hidden className="text-uoc-500 dark:text-uoc-300">
          {icon}
        </span>
        {label}
      </div>
      <p className={`text-2xl font-semibold tabular-nums leading-tight ${valueTone}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
      {children && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

function ProviderCard({
  id,
  label,
  icon,
  p,
  model,
  at,
}: {
  id: ProviderName;
  label: string;
  icon: ReactNode;
  p: ProviderState;
  model: string;
  at: number;
}) {
  const now = useNow(1000);
  const remaining = Math.max(0, p.cooldown_s - Math.floor((now - at) / 1000));
  const degraded = p.status === "degraded" && remaining > 0;
  const err = p.last_error;
  const errorTotal = Object.values(p.errors).reduce((a, b) => a + b, 0);
  const tone: Tone = degraded ? (err && NEEDS_ACTION.has(err.kind) ? "bad" : "warn") : "good";
  return (
    <Card as="article" aria-labelledby={`prov-${id}`} className={degraded ? "ring-2 ring-amber-400/70" : ""}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-uoc-100 text-uoc-600 dark:bg-uoc-800 dark:text-uoc-200">
            {icon}
          </span>
          <div className="min-w-0">
            <h3 id={`prov-${id}`} className="text-sm font-semibold leading-tight">
              {label}
            </h3>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400" title={model}>
              {model}
            </p>
          </div>
        </div>
        <Chip tone={tone}>
          {degraded ? (
            <AlertTriangle aria-hidden className="h-3 w-3" />
          ) : (
            <CheckCircle2 aria-hidden className="h-3 w-3" />
          )}
          {degraded ? "Degraded" : "Healthy"}
        </Chip>
      </div>
      {degraded && (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
          <Timer aria-hidden className="h-3.5 w-3.5" /> Paused for {fmtDuration(remaining)} - answers use search results
          only
        </p>
      )}
      {err ? (
        <div className="mt-3 space-y-1.5 rounded-2xl bg-white/50 p-3 text-xs dark:bg-white/5">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold">{KIND_LABEL[err.kind] ?? humanize(err.kind)}</span>
            <span className="text-slate-500 dark:text-slate-400" title={fullTime(err.at)}>
              {relTime(err.at, now)}
            </span>
          </p>
          <p className="leading-relaxed text-slate-600 dark:text-slate-300">{err.hint}</p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">No errors since the server started.</p>
      )}
      {errorTotal > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={`${label} error counts`}>
          {Object.entries(p.errors).map(([k, n]) => (
            <li key={k}>
              <Chip>
                {KIND_LABEL[k] ?? humanize(k)} <b className="tabular-nums">{n}</b>
              </Chip>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Rank({
  items,
  empty,
  right,
}: {
  items: { text: string; n?: number; when?: string }[];
  empty: string;
  right?: (i: number) => ReactNode;
}) {
  if (!items.length) return <EmptyState title={empty} />;
  return (
    <ol className="divide-y divide-uoc-100/70 dark:divide-white/10">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-3 py-2.5">
          <span
            aria-hidden
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-uoc-100 text-[11px] font-semibold text-uoc-700 dark:bg-uoc-800 dark:text-uoc-200"
          >
            {i + 1}
          </span>
          <p className="min-w-0 flex-1 break-words text-sm leading-snug">{it.text}</p>
          {it.n != null && (
            <Chip tone="brand" title="Times asked">
              {fmtInt(it.n)}x
            </Chip>
          )}
          {it.when && (
            <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400" title={fullTime(it.when)}>
              {relTime(it.when)}
            </span>
          )}
          {right?.(i)}
        </li>
      ))}
    </ol>
  );
}

export default function Overview({ go, isAdmin }: { go: (tab: TabId) => void; isAdmin: boolean }) {
  const stats = useResource<Stats>(getStats, { interval: POLL_MS });
  const docs = useResource(getDocuments, { interval: POLL_MS * 4 });
  const now = useNow(5000);
  const s = stats.data;

  if (!s) {
    return stats.error ? (
      <Note
        kind="error"
        title="Couldn't load the overview"
        action={
          <button className={btnSecondary} onClick={() => void stats.reload()}>
            Try again
          </button>
        }
      >
        {stats.error.message}
      </Note>
    ) : (
      <div className="space-y-4" aria-busy="true" aria-label="Loading overview">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
        <Skeleton className="h-56" />
      </div>
    );
  }

  const u = s.usage;
  const answerable = (u.outcomes.answered ?? 0) + (u.outcomes.fallback ?? 0) + (u.outcomes.degraded ?? 0);
  const answeredRate = answerable ? (u.outcomes.answered ?? 0) / answerable : null;
  const degradedNow = PROVIDERS.filter(
    (p) => s.providers[p.id].status === "degraded" && s.providers[p.id].cooldown_s > 0,
  );
  const actionNeeded = degradedNow.some((p) => NEEDS_ACTION.has(s.providers[p.id].last_error?.kind ?? ""));
  const modelOf = (id: ProviderName) =>
    id === "llm"
      ? `${humanize(s.system.llm_provider)} - ${s.system.llm_model}`
      : id === "embedding"
        ? humanize(s.system.embed_provider)
        : "Uses the language model";
  const cacheNs = Object.entries(s.cache.namespaces);
  const usingRedis = s.system.cache_backend === "redis";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500 dark:text-slate-400" aria-live="off">
          Updated {relTime(stats.at / 1000, now)} - refreshes every {POLL_MS / 1000}s while this tab is open
        </p>
        <button
          onClick={() => void stats.reload()}
          disabled={stats.refreshing}
          className={btnSecondary}
          aria-label="Refresh statistics"
        >
          <RefreshCw aria-hidden className={`h-4 w-4 ${stats.refreshing ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {stats.error && (
        <Note kind="warn" title="Couldn't refresh">
          Showing the last data we received. {stats.error.message}
        </Note>
      )}

      {degradedNow.length > 0 && (
        <div
          role="alert"
          className={`flex animate-rise items-start gap-3 rounded-3xl border-2 p-4 shadow-lg ${actionNeeded ? "border-red-400 bg-red-50 text-red-950 dark:border-red-700 dark:bg-red-950/70 dark:text-red-50" : "border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-600 dark:bg-amber-950/70 dark:text-amber-50"}`}
        >
          <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm font-semibold">
              {degradedNow.map((p) => p.label.toLowerCase()).join(" and ")} {degradedNow.length > 1 ? "are" : "is"}{" "}
              having trouble. Students are getting search-only answers.
            </p>
            <ul className="space-y-1.5 text-[13px] leading-relaxed">
              {degradedNow.map((p) => {
                const st = s.providers[p.id];
                const left = Math.max(0, st.cooldown_s - Math.floor((now - stats.at) / 1000));
                return (
                  <li key={p.id}>
                    <b>{p.label}:</b> {KIND_LABEL[st.last_error?.kind ?? "unknown"] ?? "Error"}. {st.last_error?.hint}{" "}
                    <span className="whitespace-nowrap font-medium">
                      Retrying automatically in about {fmtDuration(left)}.
                    </span>
                  </li>
                );
              })}
            </ul>
            {actionNeeded && isAdmin && (
              <button onClick={() => go("settings")} className={`${btnPrimary} mt-1`}>
                Open settings
              </button>
            )}
          </div>
        </div>
      )}

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={<MessageSquare className="h-4 w-4" />}
          label="Chats"
          value={fmtInt(u.total)}
          sub={`${fmtInt(u.last_24h)} today - ${fmtInt(u.last_7d)} this week`}
        >
          <Sparkline values={u.by_day.map((d) => d.chats)} label="Chats per day, last 14 days" />
        </Kpi>
        <Kpi
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Answered"
          value={fmtPct(answeredRate)}
          sub={`${fmtInt(u.outcomes.answered ?? 0)} of ${fmtInt(answerable)}`}
        >
          <RatioBar ratio={answeredRate} label="Answered rate" tone="good" />
        </Kpi>
        <Kpi
          icon={<Search className="h-4 w-4" />}
          label="Couldn't answer"
          value={fmtPct(u.fallback_rate)}
          tone={(u.fallback_rate ?? 0) > 0.25 ? "warn" : undefined}
          sub="Fell back to the contact page"
        >
          <RatioBar ratio={u.fallback_rate} label="Fallback rate" tone="warn" />
        </Kpi>
        <Kpi
          icon={<AlertTriangle className="h-4 w-4" />}
          label="AI unavailable"
          value={fmtPct(u.degraded_rate)}
          tone={(u.degraded_rate ?? 0) > 0.05 ? "bad" : undefined}
          sub="Search-only answers"
        >
          <RatioBar ratio={u.degraded_rate} label="Degraded rate" tone="bad" />
        </Kpi>
        <Kpi
          icon={<Timer className="h-4 w-4" />}
          label="Average latency"
          value={fmtMs(u.latency_ms.avg)}
          sub={`p50 ${fmtMs(u.latency_ms.p50)} - p95 ${fmtMs(u.latency_ms.p95)}`}
        />
        <Kpi
          icon={<Zap className="h-4 w-4" />}
          label="Answer cache hits"
          value={fmtPct(u.cache_answer_hit_rate)}
          sub={`cached ${fmtMs(u.latency_ms.p50_cached)} vs fresh ${fmtMs(u.latency_ms.p50_uncached)}`}
        >
          <RatioBar ratio={u.cache_answer_hit_rate} label="Answer cache hit rate" />
        </Kpi>
        <Kpi
          icon={<ThumbsUp className="h-4 w-4" />}
          label="Feedback"
          value={
            <span className="inline-flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <ThumbsUp aria-label="Thumbs up" className="h-4 w-4 text-emerald-500" />
                {fmtInt(u.feedback.up)}
              </span>
              <span className="inline-flex items-center gap-1">
                <ThumbsDown aria-label="Thumbs down" className="h-4 w-4 text-red-500" />
                {fmtInt(u.feedback.down)}
              </span>
            </span>
          }
          sub={u.feedback.positive_rate == null ? "No ratings yet" : `${fmtPct(u.feedback.positive_rate)} positive`}
        />
        <Kpi
          icon={<Database className="h-4 w-4" />}
          label="Knowledge base"
          value={fmtInt(s.system.chunks)}
          sub={docs.data ? `passages in ${fmtInt(docs.data.documents.length)} documents` : "passages"}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" aria-labelledby="ov-days">
          <SectionTitle
            id="ov-days"
            icon={<Activity className="h-4 w-4" />}
            title="Chats per day"
            hint="Last 14 days"
          />
          <DayBars data={u.by_day} />
        </Card>
        <Card aria-labelledby="ov-out">
          <SectionTitle
            id="ov-out"
            icon={<CheckCircle2 className="h-4 w-4" />}
            title="How chats ended"
            hint="All recorded chats"
          />
          <OutcomeBar outcomes={u.outcomes} />
        </Card>
      </div>

      <section aria-labelledby="ov-prov">
        <h2 id="ov-prov" className="mb-2 px-1 text-sm font-semibold text-uoc-900 dark:text-uoc-50">
          AI provider health
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {PROVIDERS.map((p) => (
            <ProviderCard
              key={p.id}
              id={p.id}
              label={p.label}
              icon={p.icon}
              p={s.providers[p.id]}
              model={modelOf(p.id)}
              at={stats.at}
            />
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card aria-labelledby="ov-cache">
          <SectionTitle
            id="ov-cache"
            icon={<HardDrive className="h-4 w-4" />}
            title="Cache and data"
            actions={
              <Chip
                tone={
                  s.cache.circuit_open ? "bad" : usingRedis ? "good" : s.cache.backend === "off" ? "warn" : "neutral"
                }
              >
                {s.cache.circuit_open
                  ? "Redis unreachable - running without cache"
                  : usingRedis
                    ? "Redis (shared)"
                    : s.cache.backend === "off"
                      ? "Cache off"
                      : "In-memory (this server only)"}
              </Chip>
            }
          />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Fact
              label="Data updated"
              value={s.system.data_updated_at ? relTime(s.system.data_updated_at, now) : "Never"}
              title={fullTime(s.system.data_updated_at)}
            />
            <Fact label="Data version" value={s.system.data_version} mono />
            <Fact label="Storage" value={humanize(s.system.store)} />
            <Fact label="Uptime" value={fmtDuration(s.system.uptime_s)} />
            <Fact label="Cache entries" value={s.cache.entries != null ? fmtInt(s.cache.entries) : "-"} />
            <Fact
              label="Server p50 / p95"
              value={
                s.system.process_latency_ms.samples
                  ? `${fmtMs(s.system.process_latency_ms.p50)} / ${fmtMs(s.system.process_latency_ms.p95)}`
                  : "No samples yet"
              }
            />
          </dl>
          {cacheNs.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Cache hit rate
              </h3>
              <ul className="space-y-2">
                {cacheNs.map(([ns, c]) => (
                  <li key={ns} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-xs">
                    <span className="truncate font-medium" title={ns}>
                      {humanize(ns)}
                    </span>
                    <RatioBar ratio={c.hit_rate} label={`${humanize(ns)} cache hit rate`} />
                    <span className="w-24 text-right tabular-nums text-slate-500 dark:text-slate-400">
                      {fmtPct(c.hit_rate)} ({fmtInt(c.hit)}/{fmtInt(c.hit + c.miss)})
                      {c.error > 0 && <span className="text-red-600"> {c.error} err</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card aria-labelledby="ov-top">
          <SectionTitle
            id="ov-top"
            icon={<MessageSquare className="h-4 w-4" />}
            title="Top questions"
            hint="Most common answered questions"
          />
          <Rank items={u.top_questions.map((q) => ({ text: q.question, n: q.count }))} empty="No questions yet" />
        </Card>
      </div>

      <Card aria-labelledby="ov-un">
        <SectionTitle
          id="ov-un"
          icon={<AlertTriangle className="h-4 w-4" />}
          title="Recently unanswered"
          hint="Questions the assistant couldn't answer from the knowledge base"
          actions={
            u.unanswered.length > 0 && (
              <button onClick={() => go("quality")} className={btnSecondary}>
                Review and add answers
              </button>
            )
          }
        />
        <Rank
          items={u.unanswered.slice(0, 6).map((q) => ({ text: q.question, when: q.at }))}
          empty="Nothing unanswered. Nice."
        />
      </Card>
    </div>
  );
}

function Fact({ label, value, mono, title }: { label: string; value: string; mono?: boolean; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={`truncate font-medium ${mono ? "font-mono text-xs" : ""}`} title={title ?? value}>
        {value}
      </dd>
    </div>
  );
}
