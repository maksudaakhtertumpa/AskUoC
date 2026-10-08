"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

/** Segment error boundary. Renders only the opaque digest, never the error message or stack. */
export default function SegmentError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error); // developers can match the digest in server logs
  }, [error]);

  return (
    <div className="app-bg flex min-h-dvh items-center justify-center px-4 py-10 text-slate-900 dark:text-slate-100">
      <main id="main" role="alert" className="glass-strong w-full max-w-md rounded-3xl p-7 text-center sm:p-9">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-uoc-600 to-magenta-500 text-white shadow-lg shadow-uoc-600/30">
          <AlertTriangle className="h-7 w-7" aria-hidden />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-uoc-900 dark:text-white">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Sorry - an unexpected error stopped this page from loading. It is often temporary, so trying again usually
          helps.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-uoc-600 to-magenta-500 px-6 text-sm font-medium text-white shadow-md shadow-uoc-600/25 transition hover:brightness-110 active:scale-95"
          >
            <RotateCw className="h-4 w-4" aria-hidden /> Try again
          </button>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-uoc-200 px-6 text-sm font-medium text-uoc-700 transition hover:bg-uoc-600/10 dark:border-white/15 dark:text-uoc-100 dark:hover:bg-white/10"
          >
            Back to chat
          </Link>
        </div>
        {error.digest && (
          <p className="mt-6 text-[11px] text-slate-500 dark:text-slate-400">
            Error reference: <code className="font-mono">{error.digest}</code>
          </p>
        )}
      </main>
    </div>
  );
}
