"use client";

import { Check, CloudOff, LayoutDashboard, LogIn, LogOut, RefreshCw, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/lib/auth";
import type { SyncState } from "@/lib/useSync";
import Tip from "./Tip";
import Avatar from "./ui/Avatar";

const SYNC: Record<Exclude<SyncState, "off">, { text: string; Icon: typeof Check; tone: string }> = {
  syncing: { text: "Syncing your chats…", Icon: RefreshCw, tone: "text-uoc-500" },
  synced: { text: "Chats synced to your account", Icon: Check, tone: "text-emerald-600" },
  error: { text: "Couldn't sync - will retry", Icon: CloudOff, tone: "text-amber-600" },
};
const item =
  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-uoc-100/70 dark:hover:bg-uoc-800/60";

/** Bottom-of-sidebar account control: Sign in when signed out, else avatar and name with a menu. */
export default function AccountMenu({
  collapsed,
  syncState,
  onSignIn,
  onSignOut,
  onNavigate,
}: {
  collapsed: boolean;
  syncState: SyncState;
  onSignIn: () => void;
  onSignOut: () => void;
  onNavigate: () => void;
}) {
  const { user, avatar, isStaff } = useAuth();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rect) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setRect(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setRect(null);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [rect]);

  if (user === undefined) return <div className={collapsed ? "h-10 w-10" : "h-11"} aria-hidden />; // checking the saved session
  if (!user) {
    return collapsed ? (
      <Tip label="Sign in" side="right">
        <button
          onClick={onSignIn}
          aria-label="Sign in"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-uoc-700 transition hover:bg-uoc-100/80 dark:text-uoc-200 dark:hover:bg-uoc-800/70"
        >
          <LogIn className="h-[18px] w-[18px]" />
        </button>
      </Tip>
    ) : (
      <button
        onClick={onSignIn}
        className="flex w-full items-center gap-3 rounded-xl border border-uoc-200/70 bg-white/40 px-3 py-2.5 text-sm font-medium text-uoc-700 transition hover:bg-white/70 active:scale-[0.99] dark:border-white/10 dark:bg-white/5 dark:text-uoc-100"
      >
        <LogIn className="h-[18px] w-[18px]" /> Sign in
        <span className="ml-auto text-[11px] font-normal text-slate-400">sync chats</span>
      </button>
    );
  }

  const sync = syncState !== "off" ? SYNC[syncState] : null;
  const who = user.display_name || user.username;
  return (
    <>
      <button
        onClick={(e) => setRect(rect ? null : e.currentTarget.getBoundingClientRect())}
        aria-haspopup="menu"
        aria-expanded={!!rect}
        aria-label={`Account menu for ${who}`}
        className={
          collapsed
            ? "relative flex h-10 w-10 items-center justify-center rounded-xl transition hover:bg-uoc-100/80 dark:hover:bg-uoc-800/70"
            : "flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition hover:bg-uoc-100/70 dark:hover:bg-uoc-800/60"
        }
      >
        <Avatar user={user} src={avatar} size={collapsed ? 28 : 32} />
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{who}</span>
            <span className="block truncate text-[11px] capitalize text-slate-400">{user.role}</span>
          </span>
        )}
        {sync && (
          <sync.Icon
            className={`h-3.5 w-3.5 shrink-0 ${sync.tone} ${syncState === "syncing" ? "animate-spin" : ""} ${collapsed ? "absolute -right-0.5 -top-0.5 rounded-full bg-white dark:bg-uoc-900" : ""}`}
            aria-hidden
          />
        )}
      </button>
      {rect &&
        // portal: the sidebar's backdrop-filter and overflow-hidden would clip and mis-anchor a fixed menu
        createPortal(
          <div
            ref={ref}
            role="menu"
            style={{ left: Math.min(rect.left, window.innerWidth - 268), bottom: window.innerHeight - rect.top + 8 }}
            className="glass-strong fixed z-50 w-64 animate-pop rounded-2xl p-1.5"
          >
            <div className="flex items-center gap-2.5 px-3 pb-2 pt-2">
              <Avatar user={user} src={avatar} size={36} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{who}</p>
                <p className="truncate text-xs text-slate-500">@{user.username}</p>
              </div>
            </div>
            {sync && (
              <p className="mx-3 mb-1 flex items-center gap-1.5 border-t border-uoc-100/60 pt-2 text-[11px] text-slate-500 dark:border-white/10">
                <sync.Icon className={`h-3 w-3 ${sync.tone}`} /> {sync.text}
              </p>
            )}
            <Link
              href="/profile"
              role="menuitem"
              onClick={() => {
                setRect(null);
                onNavigate();
              }}
              className={item}
            >
              <UserRound className="h-4 w-4 text-uoc-500" /> Profile &amp; settings
            </Link>
            {isStaff && (
              <Link
                href="/admin"
                role="menuitem"
                onClick={() => {
                  setRect(null);
                  onNavigate();
                }}
                className={item}
              >
                <LayoutDashboard className="h-4 w-4 text-uoc-500" />{" "}
                {user.role === "admin" ? "Admin console" : "Staff console"}
              </Link>
            )}
            <button
              role="menuitem"
              onClick={() => {
                setRect(null);
                onSignOut();
              }}
              className={`${item} hover:!bg-magenta-50 hover:!text-magenta-600 dark:hover:!bg-magenta-950/40`}
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
