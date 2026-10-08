"use client";

import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

const focus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-uoc-400 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent";
const btn = `inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 md:min-h-9 ${focus}`;
export const btnPrimary = `${btn} bg-gradient-to-r from-uoc-600 to-magenta-500 font-semibold text-white shadow-md shadow-uoc-600/25 hover:brightness-110`;
export const btnSecondary = `${btn} border border-uoc-200 bg-white/60 text-uoc-800 hover:bg-uoc-50 dark:border-uoc-700 dark:bg-white/5 dark:text-uoc-100 dark:hover:bg-uoc-800`;
export const btnGhost = `${btn} text-uoc-700 hover:bg-uoc-100/70 dark:text-uoc-200 dark:hover:bg-uoc-800/70`;
/** Square icon-only button; always pair with aria-label. */
export const btnIcon = `inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-uoc-100/70 hover:text-uoc-700 active:scale-95 disabled:opacity-40 md:h-9 md:w-9 dark:text-slate-400 dark:hover:bg-uoc-800/70 dark:hover:text-uoc-100 ${focus}`;
export const inputCls = `w-full rounded-xl border border-uoc-100 bg-white/70 px-3.5 py-2.5 text-base outline-none transition placeholder:text-slate-400 focus:border-uoc-400 focus:ring-2 focus:ring-uoc-300/50 aria-[invalid=true]:border-red-400 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-200 disabled:opacity-60 dark:border-uoc-700 dark:aria-[invalid=true]:ring-red-900/60 dark:bg-white/5 sm:text-sm`;
export const labelCls = "block text-xs font-medium text-slate-700 dark:text-slate-200";

export function Card({
  children,
  className = "",
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
  ref?: React.Ref<HTMLDivElement>;
} & React.HTMLAttributes<HTMLElement>) {
  const T = Tag as "div";
  return (
    <T className={`glass rounded-3xl p-4 sm:p-5 ${className}`} {...rest}>
      {children}
    </T>
  );
}

export function SectionTitle({
  icon,
  title,
  hint,
  actions,
  id,
}: {
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && (
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-uoc-100 text-uoc-600 dark:bg-uoc-800 dark:text-uoc-200">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 id={id} className="text-base font-semibold leading-tight text-uoc-900 dark:text-uoc-50">
            {title}
          </h2>
          {hint && <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{hint}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const TONES = {
  neutral: "bg-uoc-100/80 text-uoc-800 dark:bg-uoc-800/80 dark:text-uoc-100",
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200",
  bad: "bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-200",
  brand: "bg-magenta-100 text-magenta-800 dark:bg-magenta-900/50 dark:text-magenta-200",
  info: "bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-200",
} as const;
export type Tone = keyof typeof TONES;

export function Chip({
  children,
  tone = "neutral",
  className = "",
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-5 ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-xl bg-uoc-200/50 dark:bg-white/10 ${className}`} />;
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <Loader2 aria-hidden className={`animate-spin ${className}`} />;
}

export function ProgressBar({
  value,
  max,
  tone = "brand",
  label,
}: {
  value: number;
  max: number;
  tone?: "brand" | "good" | "bad";
  label: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const fill =
    tone === "bad" ? "bg-red-500" : tone === "good" ? "bg-emerald-500" : "bg-gradient-to-r from-uoc-500 to-magenta-500";
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max || 100}
      aria-valuenow={max > 0 ? value : undefined}
      className="h-2 w-full overflow-hidden rounded-full bg-uoc-100 dark:bg-white/10"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${fill} ${max <= 0 ? "w-1/3 animate-pulse" : ""}`}
        style={max > 0 ? { width: `${pct}%` } : undefined}
      />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  compact,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center gap-2 px-4 text-center ${compact ? "py-5" : "py-10"}`}>
      {icon && (
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-uoc-100 text-uoc-500 dark:bg-uoc-800 dark:text-uoc-300">
          {icon}
        </span>
      )}
      <p className="text-sm font-semibold text-uoc-900 dark:text-uoc-50">{title}</p>
      {children && (
        <div className="max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">{children}</div>
      )}
    </div>
  );
}

const NOTE = {
  info: {
    box: "border-uoc-200 bg-uoc-50/80 text-uoc-900 dark:border-uoc-700 dark:bg-uoc-900/60 dark:text-uoc-50",
    Icon: Info,
  },
  warn: {
    box: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-50",
    Icon: AlertTriangle,
  },
  error: {
    box: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/60 dark:text-red-50",
    Icon: AlertTriangle,
  },
  success: {
    box: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-50",
    Icon: CheckCircle2,
  },
} as const;

export function Note({
  kind = "info",
  title,
  children,
  action,
  role,
}: {
  kind?: keyof typeof NOTE;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  role?: "alert" | "status";
}) {
  const { box, Icon } = NOTE[kind];
  return (
    <div
      role={role ?? (kind === "error" ? "alert" : undefined)}
      className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${box}`}
    >
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-0.5 leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-[13px] opacity-90">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-50 ${focus} ${checked ? "bg-gradient-to-r from-uoc-600 to-magenta-500" : "bg-slate-300 dark:bg-white/20"}`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`}
      />
    </button>
  );
}

/** Semantic table wrapper: scrolls inside itself so the page never overflows horizontally. */
export function TableWrap({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="relative -mx-1 overflow-x-auto px-1" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
export const th =
  "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
export const td = "px-3 py-2.5 align-middle text-sm";

type Loaded<T> = { data: T | undefined; error: Error | null; loading: boolean; at: number };

/** Loads data and optionally polls (only while the tab is visible); failed refreshes keep the previous data. */
export function useResource<T>(
  loader: () => Promise<T>,
  { interval = 0, enabled = true }: { interval?: number; enabled?: boolean } = {},
) {
  const [state, setState] = useState<Loaded<T>>({ data: undefined, error: null, loading: true, at: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const fn = useRef(loader);
  const seq = useRef(0);
  useEffect(() => {
    fn.current = loader;
  });

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const data = await fn.current();
      if (mine === seq.current) setState({ data, error: null, loading: false, at: Date.now() });
    } catch (e) {
      if (mine === seq.current) setState((s) => ({ ...s, error: e as Error, loading: false }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
    if (!interval) return;
    const tick = () => {
      if (!document.hidden) void load();
    };
    const id = setInterval(tick, interval);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled, interval, load]);

  const reload = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const mutate = useCallback((next: T | ((prev: T | undefined) => T)) => {
    setState((s) => ({
      ...s,
      data: typeof next === "function" ? (next as (p: T | undefined) => T)(s.data) : next,
      error: null,
    }));
  }, []);

  return { ...state, refreshing, reload, mutate };
}

export type Resource<T> = ReturnType<typeof useResource<T>>;

/** Re-renders every `ms` (for live countdowns and relative times). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

type Toast = { id: number; kind: "success" | "error" | "info"; text: string };
type ToastApi = { success: (t: string) => void; error: (t: string) => void; info: (t: string) => void };
const ToastCtx = createContext<ToastApi | null>(null);
export const useToast = () => {
  const c = useContext(ToastCtx);
  if (!c) throw new Error("useToast outside <ToastProvider>");
  return c;
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: Toast["kind"], text: string) => {
      const id = next.current++;
      setToasts((t) => [...t.slice(-3), { id, kind, text }]);
      setTimeout(() => dismiss(id), kind === "error" ? 9000 : 5000);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({ success: (t) => push("success", t), error: (t) => push("error", t), info: (t) => push("info", t) }),
    [push],
  );
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)_+_5rem)] z-[70] mx-auto flex max-w-md flex-col gap-2 sm:bottom-6"
      >
        {toasts.map((t) => {
          const n = NOTE[t.kind === "error" ? "error" : t.kind === "success" ? "success" : "info"];
          return (
            <div
              key={t.id}
              role={t.kind === "error" ? "alert" : "status"}
              className={`pointer-events-auto flex animate-pop items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-sm shadow-xl backdrop-blur-xl ${n.box}`}
            >
              <n.Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0 flex-1 leading-relaxed">{t.text}</p>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss message"
                className="-m-2 rounded-lg p-2 opacity-60 hover:opacity-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
