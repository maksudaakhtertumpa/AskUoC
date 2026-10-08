"use client";

import { useEffect } from "react";

type Props = {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({ title, body, confirmLabel, danger = true, onConfirm, onCancel }: Props) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div
        className="absolute inset-0 animate-[fade_0.15s_ease-out] bg-uoc-950/50 backdrop-blur-[2px]"
        onClick={onCancel}
        aria-hidden
      />
      <div className="glass-strong relative w-full max-w-sm animate-pop rounded-3xl p-6">
        <h2 id="confirm-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            autoFocus
            className="rounded-full border border-uoc-100 px-4 py-2 text-sm font-medium transition hover:bg-uoc-50 active:scale-95 dark:border-uoc-700 dark:hover:bg-uoc-800"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-full px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 active:scale-95 ${danger ? "bg-red-600" : "bg-gradient-to-r from-uoc-600 to-magenta-500"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
