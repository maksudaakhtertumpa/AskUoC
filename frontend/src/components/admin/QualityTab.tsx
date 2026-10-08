"use client";

import { ClipboardCheck, MessageCircleQuestion, PenLine, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import { fmtInt, fmtMs, fmtPct, fullTime, getStats, relTime, type Stats } from "@/lib/admin";
import { OutcomeBar, RatioBar } from "./charts";
import { Card, Chip, EmptyState, Note, SectionTitle, Skeleton, btnSecondary, useNow, useResource } from "./ui";

/** Answer quality: unanswered and top questions, outcome split and feedback totals (no per-answer ratings exist). */
export default function QualityTab({ onAddAnswer }: { onAddAnswer: (question: string) => void }) {
  const res = useResource<Stats>(getStats);
  const now = useNow(30_000);
  const s = res.data;

  if (!s) {
    return res.error ? (
      <Note
        kind="error"
        title="Couldn't load quality data"
        action={
          <button className={btnSecondary} onClick={() => void res.reload()}>
            Try again
          </button>
        }
      >
        {res.error.message}
      </Note>
    ) : (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-40" />
        <Skeleton className="h-72" />
      </div>
    );
  }
  const u = s.usage;
  const answerable = (u.outcomes.answered ?? 0) + (u.outcomes.fallback ?? 0) + (u.outcomes.degraded ?? 0);
  const rated = u.feedback.up + u.feedback.down;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" aria-labelledby="q-out">
          <SectionTitle
            id="q-out"
            icon={<ClipboardCheck aria-hidden className="h-4 w-4" />}
            title="How answers are going"
            hint={`${fmtInt(answerable)} answerable chats recorded`}
            actions={
              <button
                onClick={() => void res.reload()}
                disabled={res.refreshing}
                className={btnSecondary}
                aria-label="Refresh"
              >
                <RefreshCw aria-hidden className={`h-4 w-4 ${res.refreshing ? "animate-spin" : ""}`} /> Refresh
              </button>
            }
          />
          <OutcomeBar outcomes={u.outcomes} />
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Couldn&apos;t answer</dt>
              <dd className="font-semibold tabular-nums">{fmtPct(u.fallback_rate, 1)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">AI unavailable</dt>
              <dd className="font-semibold tabular-nums">{fmtPct(u.degraded_rate, 1)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Typical answer time</dt>
              <dd className="font-semibold tabular-nums">{fmtMs(u.latency_ms.p50_uncached ?? u.latency_ms.p50)}</dd>
            </div>
          </dl>
        </Card>
        <Card aria-labelledby="q-fb">
          <SectionTitle id="q-fb" icon={<ThumbsUp aria-hidden className="h-4 w-4" />} title="Student feedback" />
          {rated === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No thumbs up or down yet.</p>
          ) : (
            <>
              <p className="text-3xl font-semibold tabular-nums">
                {fmtPct(u.feedback.positive_rate)} <span className="text-sm font-normal text-slate-500">positive</span>
              </p>
              <div className="my-3">
                <RatioBar ratio={u.feedback.positive_rate} label="Positive feedback share" tone="good" />
              </div>
              <p className="flex gap-4 text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <ThumbsUp aria-label="Thumbs up" className="h-4 w-4 text-emerald-500" />
                  {fmtInt(u.feedback.up)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <ThumbsDown aria-label="Thumbs down" className="h-4 w-4 text-red-500" />
                  {fmtInt(u.feedback.down)}
                </span>
              </p>
            </>
          )}
        </Card>
      </div>

      <Card aria-labelledby="q-un">
        <SectionTitle
          id="q-un"
          icon={<MessageCircleQuestion aria-hidden className="h-4 w-4" />}
          title="Questions we couldn't answer"
          hint="Newest first. Add an answer and the assistant can use it straight away."
        />
        {u.unanswered.length === 0 ? (
          <EmptyState icon={<ClipboardCheck className="h-6 w-6" />} title="Nothing to review">
            Every recent question was answered from the knowledge base.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-uoc-100/70 dark:divide-white/10">
            {u.unanswered.map((q, i) => (
              <li key={`${q.at}-${i}`} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm leading-snug">{q.question}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400" title={fullTime(q.at)}>
                    {relTime(q.at, now)}
                  </p>
                </div>
                <button
                  onClick={() => onAddAnswer(q.question)}
                  className={btnSecondary}
                  aria-label={`Add an answer for: ${q.question}`}
                >
                  <PenLine aria-hidden className="h-4 w-4" /> Add answer
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card aria-labelledby="q-top">
        <SectionTitle
          id="q-top"
          icon={<ClipboardCheck aria-hidden className="h-4 w-4" />}
          title="Most asked (and answered)"
          hint="Worth double-checking these answers are accurate and up to date."
        />
        {u.top_questions.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No answered questions yet.</p>
        ) : (
          <ol className="divide-y divide-uoc-100/70 dark:divide-white/10">
            {u.top_questions.map((q, i) => (
              <li key={i} className="flex items-start gap-3 py-2.5">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-uoc-100 text-[11px] font-semibold text-uoc-700 dark:bg-uoc-800 dark:text-uoc-200"
                >
                  {i + 1}
                </span>
                <p className="min-w-0 flex-1 break-words text-sm">{q.question}</p>
                <Chip tone="brand">{fmtInt(q.count)}x</Chip>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
