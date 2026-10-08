import type { ReactNode } from "react";

const SIDE = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  bottomEnd: "top-full right-0 mt-2", // right-edge buttons: keeps the label on screen
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
} as const;

/** CSS-only tooltip: shows on hover or keyboard focus, then fades out by itself (a clicked button keeps focus). */
export default function Tip({
  label,
  side = "top",
  hint,
  children,
}: {
  label: string;
  side?: keyof typeof SIDE;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 [@media(hover:none)]:hidden flex items-center gap-2 whitespace-nowrap rounded-full bg-slate-950 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg group-hover/tip:animate-tip group-has-[:focus-visible]/tip:animate-tip dark:bg-slate-100 dark:text-slate-900 ${SIDE[side]}`}
      >
        {label}
        {hint && (
          <kbd className="rounded bg-white/15 px-1.5 py-0.5 font-sans text-[10px] dark:bg-slate-900/10">{hint}</kbd>
        )}
      </span>
    </span>
  );
}
