"use client";

import { CheckCircle2, CircleAlert, Clock, Cog, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fmtInt, fullTime, getJobs, isActive, relTime, type Job, type JobStatus } from "@/lib/admin";
import {
  Card,
  Chip,
  EmptyState,
  Note,
  ProgressBar,
  SectionTitle,
  Skeleton,
  Spinner,
  btnSecondary,
  useNow,
  useResource,
} from "./ui";

const FAST_MS = 1500;

/** Background jobs: polls while any is active; `track()` registers a new one so a fast job still fires `onFinished`. */
export function useJobs(onFinished?: () => void) {
  const [pollMs, setPollMs] = useState(0);
  const res = useResource(getJobs, { interval: pollMs });
  const active = res.data?.some(isActive) ?? false;
  const want = active ? FAST_MS : 0;
  if (want !== pollMs) setPollMs(want); // derived state: adjusts during render, never in an effect

  const seen = useRef(new Map<string, JobStatus>());
  const cb = useRef(onFinished);
  useEffect(() => {
    cb.current = onFinished;
  });
  useEffect(() => {
    if (!res.data) return;
    let finished = false;
    for (const j of res.data) {
      const before = seen.current.get(j.id);
      if ((before === "queued" || before === "running") && (j.status === "done" || j.status === "failed"))
        finished = true;
    }
    seen.current = new Map(res.data.map((j) => [j.id, j.status]));
    if (finished) cb.current?.();
  }, [res.data]);

  const { reload } = res;
  const track = (job: Job) => {
    seen.current.set(job.id, "queued");
    void reload();
  };
  return { ...res, jobs: res.data, active, track };
}
export type JobsState = ReturnType<typeof useJobs>;

const KIND: Record<string, string> = { upload: "Upload", text: "Text entry", reindex: "Re-embed", restore: "Restore" };

function StatusChip({ status }: { status: JobStatus }) {
  if (status === "running")
    return (
      <Chip tone="info">
        <Spinner className="h-3 w-3" /> Running
      </Chip>
    );
  if (status === "queued")
    return (
      <Chip>
        <Clock aria-hidden className="h-3 w-3" /> Queued
      </Chip>
    );
  if (status === "done")
    return (
      <Chip tone="good">
        <CheckCircle2 aria-hidden className="h-3 w-3" /> Done
      </Chip>
    );
  return (
    <Chip tone="bad">
      <CircleAlert aria-hidden className="h-3 w-3" /> Failed
    </Chip>
  );
}

function JobRow({ job, now }: { job: Job; now: number }) {
  const running = job.status === "running";
  const result = Object.entries(job.result ?? {}).filter(
    ([, v]) => typeof v === "number" || (typeof v === "string" && v.length < 40),
  );
  return (
    <li className="space-y-2 py-3.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <StatusChip status={job.status} />
        <p className="min-w-0 flex-1 break-words text-sm font-medium">{job.title}</p>
        <span className="text-xs text-slate-500 dark:text-slate-400" title={fullTime(job.created_at)}>
          {KIND[job.kind] ?? job.kind} by {job.actor} - {relTime(job.created_at, now)}
        </span>
      </div>
      {(running || job.status === "queued") && (
        <ProgressBar label={`${job.title} progress`} value={job.done} max={running ? job.total : 0} />
      )}
      {(job.message || running) && (
        <p className="text-xs text-slate-600 dark:text-slate-300" aria-live={running ? "polite" : "off"}>
          {job.message || "Waiting for the previous job to finish..."}
          {running && job.total > 0 && (
            <span className="ml-1 tabular-nums text-slate-500">
              ({fmtInt(job.done)}/{fmtInt(job.total)})
            </span>
          )}
        </p>
      )}
      {job.error && (
        <Note kind="error" title="This job failed">
          {job.error}
        </Note>
      )}
      {job.status === "done" && result.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Result">
          {result.map(([k, v]) => (
            <li key={k}>
              <Chip tone="good">
                {k.replace(/_/g, " ")}: <b>{typeof v === "number" ? fmtInt(v) : String(v)}</b>
              </Chip>
            </li>
          ))}
        </ul>
      )}
      {job.log.length > 0 && (
        <details className="group text-xs">
          <summary className="inline-flex min-h-8 cursor-pointer select-none items-center text-uoc-600 hover:underline dark:text-uoc-300">
            Details ({job.log.length})
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-uoc-950/5 p-3 font-mono text-[11px] leading-relaxed dark:bg-white/5">
            {job.log.join("\n")}
          </pre>
        </details>
      )}
    </li>
  );
}

export default function JobsPanel({
  state,
  kinds,
  title = "Jobs",
  hint,
}: {
  state: JobsState;
  kinds?: string[];
  title?: string;
  hint?: string;
}) {
  const now = useNow(5000);
  const [all, setAll] = useState(false);
  const list = (state.jobs ?? []).filter((j) => !kinds || kinds.includes(j.kind));
  const shown = all ? list : list.slice(0, 4);
  const busy = list.some(isActive);
  return (
    <Card aria-labelledby="jobs-title">
      <SectionTitle
        id="jobs-title"
        icon={<Cog aria-hidden className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />}
        title={title}
        hint={
          hint ??
          (busy
            ? "Working - this updates automatically. Jobs run one at a time."
            : "Uploads, re-embedding and restores appear here.")
        }
        actions={
          <button
            onClick={() => void state.reload()}
            disabled={state.refreshing}
            className={btnSecondary}
            aria-label="Refresh jobs"
          >
            <RefreshCw aria-hidden className={`h-4 w-4 ${state.refreshing ? "animate-spin" : ""}`} /> Refresh
          </button>
        }
      />
      {state.loading ? (
        <Skeleton className="h-20" />
      ) : state.error && !state.jobs ? (
        <Note kind="error">{state.error.message}</Note>
      ) : list.length === 0 ? (
        <EmptyState compact title="No jobs yet">
          Jobs show up here with live progress, and are kept until the server restarts.
        </EmptyState>
      ) : (
        <>
          <ul className="divide-y divide-uoc-100/70 dark:divide-white/10">
            {shown.map((j) => (
              <JobRow key={j.id} job={j} now={now} />
            ))}
          </ul>
          {list.length > 4 && (
            <button onClick={() => setAll((v) => !v)} className={`${btnSecondary} mt-2`}>
              {all ? "Show fewer" : `Show all ${list.length}`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}
