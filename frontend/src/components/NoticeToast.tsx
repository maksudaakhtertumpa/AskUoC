"use client";

import { Info, TriangleAlert, X } from "lucide-react";

export type Notice = {
  kind: "info" | "warn" | "error";
  text: string;
  key: number;
  action?: { label: string; onClick: () => void };
};

const STYLE = {
  info: {
    box: "border-uoc-200 bg-uoc-50 text-uoc-800 dark:border-uoc-700 dark:bg-uoc-900 dark:text-uoc-100",
    Icon: Info,
  },
  warn: {
    box: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
    Icon: TriangleAlert,
  },
  error: {
    box: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100",
    Icon: TriangleAlert,
  },
} as const;

/** Toast pinned under the header, centred in the chat column. */
export default function NoticeToast({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  if (!notice) return null;
  const { box, Icon } = STYLE[notice.kind];
  return (
    <div
      key={notice.key}
      role="status"
      className={`absolute inset-x-3 top-[calc(env(safe-area-inset-top)_+_4rem)] z-40 mx-auto flex max-w-md animate-pop items-start gap-2.5 rounded-2xl border px-3.5 py-2.5 text-xs shadow-xl backdrop-blur-xl ${box}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1 leading-relaxed">{notice.text}</p>
      {notice.action && (
        <button
          onClick={() => {
            notice.action?.onClick();
            onDismiss();
          }}
          className="shrink-0 rounded-lg px-2 py-0.5 text-xs font-semibold underline underline-offset-2 hover:bg-black/5 dark:hover:bg-white/10"
        >
          {notice.action.label}
        </button>
      )}
      <button onClick={onDismiss} aria-label="Dismiss" className="-m-1 rounded-lg p-1.5 opacity-60 hover:opacity-100">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
