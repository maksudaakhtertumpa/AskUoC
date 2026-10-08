"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/** Accessible dialog: Esc and backdrop close, focus is moved in and restored, body scroll locked. */
export default function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    box.current?.querySelector<HTMLElement>("input, textarea, select, button:not([data-close])")?.focus();
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 animate-[fade_0.15s_ease-out] bg-uoc-950/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={box}
        className={`glass-strong relative max-h-[92dvh] w-full animate-pop overflow-y-auto rounded-t-3xl p-5 pb-[calc(env(safe-area-inset-bottom)_+_1.25rem)] sm:rounded-3xl sm:p-6 ${wide ? "max-w-2xl" : "max-w-md"}`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-uoc-900 dark:text-uoc-50">{title}</h2>
          <button
            data-close
            onClick={onClose}
            aria-label="Close"
            className="-m-2 rounded-xl p-2 text-slate-500 transition hover:bg-uoc-100/70 dark:hover:bg-uoc-800/70"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
