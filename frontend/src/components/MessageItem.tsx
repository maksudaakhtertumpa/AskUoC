"use client";

import {
  Check,
  Copy,
  CornerUpLeft,
  FileText,
  GraduationCap,
  Loader2,
  Reply,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  Volume2,
  VolumeX,
  Workflow,
} from "lucide-react";
import { useState } from "react";
import { type Msg, formatWhen } from "@/lib/history";
import { useTypewriter } from "@/lib/useTypewriter";
import FollowUps from "./FollowUps";
import Insights from "./Insights";
import MessageBody from "./MessageBody";
import Sources from "./Sources";
import Tip from "./Tip";

type Props = {
  m: Msg;
  last: boolean;
  busy: boolean;
  speech: "idle" | "loading" | "playing";
  canRegenerate: boolean;
  onReply: (m: Msg, container: Element | null) => void;
  onRate: (m: Msg, rating: 1 | -1) => void;
  onSpeak: (m: Msg) => void;
  onRegenerate: () => void;
  onFollowUp: (q: string) => void;
};

const actionBtn =
  "flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-uoc-100/70 hover:text-uoc-700 active:scale-90 dark:text-slate-400 dark:hover:bg-uoc-800/60 dark:hover:text-uoc-100 sm:h-8 sm:w-8";

function Time({ at, className = "" }: { at: number; className?: string }) {
  return (
    <time
      dateTime={new Date(at).toISOString()}
      title={new Date(at).toLocaleString()}
      className={`text-[11px] ${className}`}
    >
      {formatWhen(at)}
    </time>
  );
}

function TypingDots() {
  return (
    <span
      className="flex items-center gap-2.5 py-0.5 text-sm text-slate-500 dark:text-slate-400"
      role="status"
      aria-label="AskUoC is typing"
    >
      <span className="flex items-center gap-1.5">
        {["bg-uoc-500", "bg-magenta-500", "bg-teal-400"].map((c, i) => (
          <i
            key={c}
            style={{ animationDelay: `${i * 160}ms` }}
            className={`h-2.5 w-2.5 animate-dot rounded-full ${c}`}
          />
        ))}
      </span>
    </span>
  );
}

function Attachments({ m }: { m: Msg }) {
  const items = m.images ?? (m.image ? [{ thumb: m.image }] : []);
  if (!items.length) return null;
  return (
    <div className={`mb-2 grid gap-1.5 ${items.length === 1 ? "grid-cols-1" : "grid-cols-3"}`}>
      {items.map((it, i) => (
        <figure key={i} className="relative overflow-hidden rounded-2xl border border-white/30">
          {/* eslint-disable-next-line @next/next/no-img-element -- small local data-URL thumbnail */}
          <img
            src={it.thumb}
            alt={it.label ?? "Attachment"}
            className={`w-full object-cover ${items.length === 1 ? "max-h-56" : "aspect-square"}`}
          />
          {it.label?.includes("· p.") && (
            <figcaption className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
              <FileText className="h-3 w-3 shrink-0" /> p.{it.label.split("· p.")[1]}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}

export default function MessageItem({
  m,
  last,
  busy,
  speech,
  canRegenerate,
  onReply,
  onRate,
  onSpeak,
  onRegenerate,
  onFollowUp,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [insights, setInsights] = useState(false);
  // fixed at mount: live messages are typed out, restored history renders instantly
  const [animate] = useState(() => m.role === "assistant" && m.content === "");
  const streamDone = !(last && busy);
  const { shown, typing } = useTypewriter(m.content, streamDone, animate);

  if (m.role === "user") {
    return (
      <li className="flex animate-rise justify-end">
        <div className="max-w-[88%] rounded-3xl rounded-br-lg bg-gradient-to-br from-uoc-600 to-magenta-500 px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-lg shadow-uoc-600/25 ring-1 ring-inset ring-white/25 sm:max-w-[80%]">
          <Attachments m={m} />
          {m.quote && (
            <blockquote className="mb-2 flex gap-1.5 rounded-xl bg-white/15 px-2.5 py-1.5 text-xs text-white/90">
              <CornerUpLeft className="mt-0.5 h-3 w-3 shrink-0 opacity-80" />
              <span className="line-clamp-3">{m.quote}</span>
            </blockquote>
          )}
          <p className="whitespace-pre-wrap break-words">{m.content}</p>
          {m.at && <Time at={m.at} className="mt-1 block text-right text-white/70" />}
        </div>
      </li>
    );
  }

  const copy = async () => {
    await navigator.clipboard.writeText(m.content).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const finished = !typing && m.content !== "";

  return (
    <li className="flex animate-rise gap-2.5 sm:gap-3" data-msg>
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-uoc-600 to-magenta-500 text-white shadow-md shadow-uoc-600/25">
        <GraduationCap className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={`rounded-3xl rounded-tl-lg px-4 py-3 sm:px-5 sm:py-3.5 ${
            m.error
              ? "border border-red-200 bg-red-50/90 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
              : "glass"
          } ${shown ? "" : "inline-block"}`}
        >
          {shown ? (
            <>
              <MessageBody text={shown} sources={m.sources} />
              {typing && (
                <span
                  className="ml-0.5 inline-block h-4 w-0.5 animate-caret rounded bg-magenta-500 align-middle"
                  aria-hidden
                />
              )}
            </>
          ) : (
            <TypingDots />
          )}
        </div>

        {finished && !m.error && <Sources text={m.content} sources={m.sources} />}

        {finished && (
          <div className="-ml-1 mt-1.5 flex flex-wrap items-center gap-0.5">
            <Tip label={copied ? "Copied" : "Copy"}>
              <button onClick={copy} className={actionBtn} aria-label="Copy answer">
                {copied ? <Check className="h-4 w-4 animate-pop text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </button>
            </Tip>
            {!m.error && (
              <>
                {m.chatId && (
                  <>
                    <Tip label="Good answer">
                      <button
                        aria-label="Helpful"
                        onClick={() => onRate(m, 1)}
                        className={`${actionBtn} ${m.rating === 1 ? "!text-emerald-600" : ""}`}
                      >
                        <ThumbsUp className={`h-4 w-4 ${m.rating === 1 ? "animate-pop fill-current" : ""}`} />
                      </button>
                    </Tip>
                    <Tip label="Bad answer">
                      <button
                        aria-label="Not helpful"
                        onClick={() => onRate(m, -1)}
                        className={`${actionBtn} ${m.rating === -1 ? "!text-red-600" : ""}`}
                      >
                        <ThumbsDown className={`h-4 w-4 ${m.rating === -1 ? "animate-pop fill-current" : ""}`} />
                      </button>
                    </Tip>
                  </>
                )}
                <Tip label={speech === "idle" ? "Read aloud" : "Stop"}>
                  <button
                    onClick={() => onSpeak(m)}
                    aria-label={speech === "idle" ? "Read aloud" : "Stop reading"}
                    aria-pressed={speech !== "idle"}
                    className={`${actionBtn} ${speech !== "idle" ? "!text-magenta-600 dark:!text-magenta-300" : ""}`}
                  >
                    {speech === "loading" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : speech === "playing" ? (
                      <VolumeX className="h-4 w-4 animate-pop" />
                    ) : (
                      <Volume2 className="h-4 w-4" />
                    )}
                  </button>
                </Tip>
                <Tip label="Reply (highlight text to quote part)">
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => onReply(m, e.currentTarget.closest("[data-msg]"))}
                    className={actionBtn}
                    aria-label="Reply to this answer"
                  >
                    <Reply className="h-4 w-4" />
                  </button>
                </Tip>
              </>
            )}
            {m.trace && !m.error && (
              <Tip label="How this was answered">
                <button
                  onClick={() => setInsights((v) => !v)}
                  aria-expanded={insights}
                  aria-label="How this was answered"
                  className={`${actionBtn} ${insights ? "!text-uoc-700 dark:!text-uoc-100" : ""}`}
                >
                  <Workflow className="h-4 w-4" />
                </button>
              </Tip>
            )}
            {last && canRegenerate && (
              <Tip label="Regenerate">
                <button onClick={onRegenerate} className={actionBtn} aria-label="Regenerate answer">
                  <RotateCcw className="h-4 w-4" />
                </button>
              </Tip>
            )}
            {m.at && <Time at={m.at} className="ml-2 text-slate-400 dark:text-slate-500" />}
          </div>
        )}
        {finished && insights && m.trace && <Insights trace={m.trace} />}
        {finished && last && !busy && !m.error && m.suggestions && (
          <FollowUps items={m.suggestions} onPick={onFollowUp} />
        )}
        {finished && m.degraded && (
          <p
            role="status"
            className="mt-2 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100"
          >
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {m.degraded.message}
              {canRegenerate && last && (
                <>
                  {" "}
                  <button onClick={onRegenerate} className="font-semibold underline underline-offset-2">
                    Try again
                  </button>
                </>
              )}
            </span>
          </p>
        )}
      </div>
    </li>
  );
}
