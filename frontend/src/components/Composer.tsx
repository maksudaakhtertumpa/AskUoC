"use client";

import { ArrowUp, CornerUpLeft, FileText, Mic, Plus, Square, X } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { ATTACH_ACCEPT, MAX_ATTACHMENTS, type Attachment } from "@/lib/attachments";
import Footer from "./Footer";
import Tip from "./Tip";

type Props = {
  variant: "center" | "dock";
  value: string;
  onChange: (v: string) => void;
  busy: boolean;
  onSend: () => void;
  onStop: () => void;
  quote: string | null;
  onClearQuote: () => void;
  attachments: Attachment[];
  pending: number; // files still being converted (shimmer placeholders)
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  limitHit: number; // increments when the user exceeds the limit, to shake the counter
  listening: boolean;
  micSupported: boolean;
  onToggleMic: () => void;
  dataDate: string | null;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
};

export default function Composer({ inputRef, ...p }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const hasFiles = p.attachments.length > 0;
  const canSend = !p.busy && p.pending === 0 && (p.value.trim().length > 0 || hasFiles);
  const full = p.attachments.length >= MAX_ATTACHMENTS;

  // auto-grow, including when dictation fills the box
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [p.value, inputRef]);

  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    if (files.length) {
      e.preventDefault();
      p.onAddFiles(files);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    p.onAddFiles([...e.dataTransfer.files]);
  };

  const wrap =
    p.variant === "dock"
      ? "mx-auto w-full max-w-3xl px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4"
      : "w-full max-w-3xl";

  return (
    <div className={`${wrap} relative`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) p.onSend();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`glass-input relative rounded-[28px] p-2 transition duration-200 focus-within:ring-2 focus-within:ring-uoc-400/40 ${
          dragging ? "!border-magenta-500 ring-4 ring-magenta-500/20" : ""
        }`}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex animate-[fade_0.15s_ease-out] items-center justify-center rounded-[28px] border-2 border-dashed border-magenta-500 bg-white/90 text-sm font-medium text-magenta-600 dark:bg-uoc-950/90">
            Drop images or PDFs here (up to {MAX_ATTACHMENTS})
          </div>
        )}

        {p.quote && (
          <div className="mb-2 flex animate-pop items-start gap-2 rounded-2xl border-l-4 border-magenta-500 bg-uoc-50 py-2 pl-3 pr-2 dark:bg-uoc-800/60">
            <CornerUpLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-magenta-500" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-magenta-600 dark:text-magenta-300">Replying to AskUoC</p>
              <p className="line-clamp-2 text-xs text-slate-700 dark:text-slate-300">{p.quote}</p>
            </div>
            <button
              type="button"
              onClick={p.onClearQuote}
              aria-label="Remove quote"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-700 dark:hover:bg-uoc-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {(hasFiles || p.pending > 0) && (
          <div className="mb-2 flex items-center gap-2 overflow-x-auto px-1 pb-1 pt-1.5">
            {p.attachments.map((a) => (
              <div key={a.id} className="relative shrink-0 animate-pop">
                {/* eslint-disable-next-line @next/next/no-img-element -- local data-URL preview */}
                <img
                  src={a.thumb}
                  alt={a.label ?? "Attachment"}
                  className="h-16 w-16 rounded-xl border border-uoc-100 object-cover shadow-sm dark:border-uoc-700"
                />
                {a.pdf && (
                  <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 rounded-b-xl bg-uoc-700/85 py-0.5 text-[9px] font-medium text-white">
                    <FileText className="h-2.5 w-2.5" /> {a.label?.split("· ")[1]}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => p.onRemoveAttachment(a.id)}
                  aria-label={`Remove ${a.label ?? "attachment"}`}
                  className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-white shadow hover:bg-red-600 sm:h-5 sm:w-5"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {Array.from({ length: p.pending }).map((_, i) => (
              <div
                key={i}
                aria-label="Converting"
                className="h-16 w-16 shrink-0 animate-shimmer rounded-xl bg-[length:200%_100%] bg-gradient-to-r from-uoc-100 via-magenta-100 to-uoc-100 dark:from-uoc-800 dark:via-uoc-700 dark:to-uoc-800"
              />
            ))}
            <span
              key={p.limitHit}
              className={`ml-auto shrink-0 self-start rounded-full px-2 py-0.5 text-[11px] font-medium ${full ? "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200" : "bg-uoc-100 text-uoc-700 dark:bg-uoc-800 dark:text-uoc-200"} ${p.limitHit > 0 && full ? "animate-shake" : ""}`}
            >
              {p.attachments.length}/{MAX_ATTACHMENTS}
            </span>
          </div>
        )}

        <div className="flex items-end gap-1">
          <input
            ref={fileRef}
            type="file"
            accept={ATTACH_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              p.onAddFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <Tip label={`Add photos or PDF (up to ${MAX_ATTACHMENTS})`}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Attach images or a PDF"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-uoc-600 transition hover:bg-uoc-100/70 active:scale-90 dark:text-uoc-300 dark:hover:bg-uoc-800 sm:h-10 sm:w-10"
            >
              <Plus className="h-5 w-5" />
            </button>
          </Tip>
          <textarea
            ref={inputRef}
            value={p.value}
            onChange={(e) => p.onChange(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              // Enter sends on desktop; on touch keyboards it is a newline
              if (e.key === "Enter" && !e.shiftKey && matchMedia("(hover: hover)").matches) {
                e.preventDefault();
                if (canSend) p.onSend();
              }
            }}
            rows={1}
            maxLength={600}
            enterKeyHint="send"
            placeholder={
              p.listening
                ? "Listening…"
                : p.quote
                  ? "Ask a follow-up about this…"
                  : hasFiles
                    ? "Add a question about the attachments…"
                    : "Ask AskUoC"
            }
            aria-label="Your question"
            className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-3 text-base outline-none placeholder:text-slate-400 sm:min-h-10 sm:py-2.5 sm:text-[15px]"
          />
          {p.micSupported && !p.busy && (
            <Tip label={p.listening ? "Stop dictation" : "Dictate"}>
              <button
                type="button"
                onClick={p.onToggleMic}
                aria-label={p.listening ? "Stop dictation" : "Dictate"}
                aria-pressed={p.listening}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-90 sm:h-10 sm:w-10 ${
                  p.listening
                    ? "bg-magenta-50 text-magenta-600 dark:bg-magenta-950/50"
                    : "text-slate-500 hover:bg-uoc-100/70 dark:hover:bg-uoc-800"
                }`}
              >
                {p.listening ? (
                  <span className="flex h-4 items-center gap-[3px]" aria-hidden>
                    {[0, 1, 2, 3].map((i) => (
                      <i
                        key={i}
                        style={{ animationDelay: `${i * 120}ms` }}
                        className="h-4 w-[3px] origin-center animate-[eq_0.9s_ease-in-out_infinite] rounded-full bg-current"
                      />
                    ))}
                  </span>
                ) : (
                  <Mic className="h-[18px] w-[18px]" />
                )}
              </button>
            </Tip>
          )}
          {p.busy ? (
            <button
              type="button"
              onClick={p.onStop}
              aria-label="Stop generating"
              className="flex h-11 w-11 shrink-0 animate-pop items-center justify-center rounded-full bg-uoc-900 text-white transition active:scale-90 sm:h-10 sm:w-10 dark:bg-white dark:text-uoc-900"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-uoc-600 to-magenta-500 text-white shadow-md shadow-magenta-500/30 transition enabled:hover:scale-105 enabled:active:scale-90 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 disabled:shadow-none sm:h-10 sm:w-10 dark:disabled:from-uoc-800 dark:disabled:to-uoc-800 dark:disabled:text-uoc-600"
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          )}
        </div>
      </form>
      {p.variant === "dock" && (
        <div className="mt-2">
          <Footer dataDate={p.dataDate} />
        </div>
      )}
    </div>
  );
}
