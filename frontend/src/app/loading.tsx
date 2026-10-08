/** Brand spinner shown while a route segment loads. */
export default function Loading() {
  return (
    <div className="app-bg flex min-h-dvh items-center justify-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4">
        <div className="relative h-14 w-14">
          <span className="absolute inset-0 animate-ping-slow rounded-2xl bg-uoc-500/30" aria-hidden />
          <span
            className="relative flex h-14 w-14 animate-pulse items-center justify-center rounded-2xl bg-gradient-to-br from-uoc-600 to-magenta-500 text-lg font-bold text-white shadow-lg shadow-uoc-600/30"
            aria-hidden
          >
            U
          </span>
        </div>
        <span className="text-sm text-slate-500 dark:text-slate-400">Loading…</span>
      </div>
    </div>
  );
}
