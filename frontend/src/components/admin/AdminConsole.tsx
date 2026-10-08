"use client";

import { ArrowLeft, LogOut, Lock, Moon, ShieldAlert, ShieldCheck, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import AuthDialog from "@/components/AuthDialog";
import ConfirmDialog from "@/components/ConfirmDialog";
import Avatar from "@/components/ui/Avatar";
import { useAuth } from "@/lib/auth";
import AuditTab from "./AuditTab";
import DataTab, { type TextDraft } from "./DataTab";
import Overview from "./Overview";
import QualityTab from "./QualityTab";
import SettingsTab from "./SettingsTab";
import SnapshotsTab from "./SnapshotsTab";
import { TABS, isTabId, type TabId } from "./tabs";
import { Chip, Skeleton, ToastProvider, btnPrimary, btnSecondary } from "./ui";
import UsersTab from "./UsersTab";

const shell = "app-bg h-dvh overflow-y-auto overflow-x-hidden text-slate-900 dark:text-slate-100";

/** Same mechanism as the chat page: a `dark` class on <html>, remembered in localStorage. */
function useDarkMode(): [boolean, () => void] {
  const dark = useSyncExternalStore(
    (cb) => {
      const o = new MutationObserver(cb);
      o.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      return () => o.disconnect();
    },
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
  const toggle = () => {
    const next = document.documentElement.classList.toggle("dark");
    try {
      localStorage.setItem("askuoc_theme", next ? "dark" : "light");
    } catch {
      /* private mode: theme just won't persist */
    }
  };
  return [dark, toggle];
}

function Gate({
  icon,
  title,
  children,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <div className={`${shell} flex items-center justify-center p-4`}>
      <main className="glass-strong w-full max-w-md animate-rise rounded-3xl p-7 text-center sm:p-9">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-uoc-600 to-magenta-500 text-white shadow-lg shadow-uoc-600/30">
          {icon}
        </span>
        <h1 className="mt-5 text-xl font-semibold text-uoc-900 dark:text-uoc-50">{title}</h1>
        <div className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{children}</div>
        <div className="mt-6 flex flex-col-reverse justify-center gap-2 sm:flex-row">{actions}</div>
      </main>
    </div>
  );
}

const ROLE_LABEL = { admin: "Admin", staff: "Staff", user: "Student" } as const;

export default function AdminConsole() {
  const { user, avatar, isStaff, isAdmin, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [dark, toggleTheme] = useDarkMode();
  const [authOpen, setAuthOpen] = useState(false);
  const [draft, setDraft] = useState<TextDraft | null>(null);
  const [pending, setPending] = useState<TabId | null>(null);
  const settingsDirty = useRef(false);
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  const tabs = useMemo(() => TABS.filter((t) => !t.admin || isAdmin), [isAdmin]);
  const asked = params.get("tab");
  const tab: TabId = isTabId(asked) && tabs.some((t) => t.id === asked) ? asked : "overview";

  const select = useCallback(
    (id: TabId, force = false) => {
      if (id === tab) return;
      if (!force && tab === "settings" && settingsDirty.current) return setPending(id);
      router.replace(id === "overview" ? pathname : `${pathname}?tab=${id}`, { scroll: false });
    },
    [tab, router, pathname],
  );
  const onDirty = useCallback((d: boolean) => void (settingsDirty.current = d), []);
  const consumeDraft = useCallback(() => setDraft(null), []);

  // Keep the active pill visible in the scrolling bar (mobile).
  useEffect(() => {
    tabRefs.current[tab]?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [tab]);

  const onTabKey = (e: KeyboardEvent, i: number) => {
    const move =
      e.key === "ArrowRight"
        ? i + 1
        : e.key === "ArrowLeft"
          ? i - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : null;
    if (move === null) return;
    e.preventDefault();
    const next = tabs[(move + tabs.length) % tabs.length];
    tabRefs.current[next.id]?.focus();
    select(next.id);
  };

  if (user === undefined) {
    return (
      <div className={`${shell} p-6`} aria-busy="true" aria-label="Checking your session">
        <div className="mx-auto max-w-6xl space-y-4">
          <Skeleton className="h-14" />
          <Skeleton className="h-11 w-2/3" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }
  if (user === null) {
    return (
      <>
        <Gate
          icon={<Lock className="h-6 w-6" />}
          title="Admin console"
          actions={
            <>
              <Link href="/" className={btnSecondary}>
                Back to chat
              </Link>
              <button onClick={() => setAuthOpen(true)} className={btnPrimary} autoFocus>
                Sign in
              </button>
            </>
          }
        >
          This area is for University of Cyberjaya staff and administrators. Sign in with your staff or admin account to
          continue.
        </Gate>
        {authOpen && (
          <AuthDialog onClose={() => setAuthOpen(false)} reason="Sign in with your staff or admin account." />
        )}
      </>
    );
  }
  if (!isStaff) {
    return (
      <Gate
        icon={<ShieldAlert className="h-6 w-6" />}
        title="You don't have access"
        actions={
          <>
            <button onClick={logout} className={btnSecondary}>
              <LogOut aria-hidden className="h-4 w-4" /> Sign out
            </button>
            <Link href="/" className={btnPrimary}>
              <ArrowLeft aria-hidden className="h-4 w-4" /> Back to chat
            </Link>
          </>
        }
      >
        You&apos;re signed in as <b>{user.display_name}</b>, but this console needs a staff or admin account. If you
        think that&apos;s a mistake, ask an administrator to change your role.
      </Gate>
    );
  }

  return (
    <ToastProvider>
      <div className={shell}>
        <a
          href="#admin-main"
          className="sr-only rounded-full bg-white px-4 py-2 text-sm font-medium text-uoc-800 shadow focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80]"
        >
          Skip to content
        </a>
        <div className="sticky top-0 z-30 border-b border-uoc-200/50 bg-white/75 pt-[env(safe-area-inset-top)] backdrop-blur-xl dark:border-white/10 dark:bg-uoc-950/70">
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-6">
            <Link
              href="/"
              aria-label="Back to chat"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-uoc-700 transition hover:bg-uoc-100/80 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-uoc-400 md:h-10 md:w-10 dark:text-uoc-200 dark:hover:bg-uoc-800/70"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <span
              aria-hidden
              className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-uoc-600 to-magenta-500 text-white shadow-md shadow-uoc-600/25 sm:flex"
            >
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-semibold leading-tight text-uoc-900 sm:text-lg dark:text-uoc-50">
                Admin console
              </h1>
              <p className="hidden truncate text-xs text-slate-500 sm:block dark:text-slate-400">
                AskUoC - University of Cyberjaya
              </p>
            </div>
            <button
              onClick={toggleTheme}
              aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-uoc-700 transition hover:bg-uoc-100/80 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-uoc-400 md:h-10 md:w-10 dark:text-uoc-200 dark:hover:bg-uoc-800/70"
            >
              {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <div className="flex min-w-0 items-center gap-2.5 rounded-full py-0.5 pl-0.5 sm:pr-3">
              <Avatar user={user} src={avatar} size={36} />
              <div className="hidden min-w-0 leading-tight sm:block">
                <p className="max-w-40 truncate text-sm font-medium">{user.display_name}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{ROLE_LABEL[user.role]}</p>
              </div>
            </div>
            <button
              onClick={logout}
              aria-label="Sign out"
              title="Sign out"
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-uoc-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-uoc-400 sm:inline-flex dark:text-slate-400 dark:hover:bg-uoc-800/70"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
          <div className="mx-auto max-w-6xl px-3 pb-2.5 sm:px-6">
            <div
              role="tablist"
              aria-label="Admin sections"
              className="flex snap-x items-center gap-1 overflow-x-auto rounded-2xl bg-uoc-100/60 p-1 [scrollbar-width:none] dark:bg-white/5 [&::-webkit-scrollbar]:hidden"
            >
              {tabs.map((t, i) => {
                const on = t.id === tab;
                return (
                  <button
                    key={t.id}
                    ref={(el) => void (tabRefs.current[t.id] = el)}
                    role="tab"
                    id={`tab-${t.id}`}
                    aria-selected={on}
                    aria-controls={`panel-${t.id}`}
                    tabIndex={on ? 0 : -1}
                    onClick={() => select(t.id)}
                    onKeyDown={(e) => onTabKey(e, i)}
                    className={`inline-flex min-h-10 shrink-0 snap-start items-center gap-2 rounded-xl px-3.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-uoc-400 ${on ? "bg-white text-uoc-700 shadow-sm ring-1 ring-uoc-200/60 dark:bg-uoc-700/50 dark:text-white dark:ring-white/10" : "text-slate-600 hover:bg-white/60 hover:text-uoc-700 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"}`}
                  >
                    <t.icon aria-hidden className="h-4 w-4" />
                    {t.label}
                  </button>
                );
              })}
              {!isAdmin && (
                <Chip
                  className="ml-auto hidden shrink-0 self-center sm:inline-flex"
                  title="Settings, users, snapshots and audit need an admin account"
                >
                  Staff access
                </Chip>
              )}
            </div>
          </div>
        </div>

        <main
          id="admin-main"
          className="mx-auto w-full max-w-6xl px-3 pb-[calc(env(safe-area-inset-bottom)_+_2rem)] pt-4 sm:px-6 sm:pt-6"
        >
          <div
            role="tabpanel"
            id={`panel-${tab}`}
            aria-labelledby={`tab-${tab}`}
            tabIndex={-1}
            className="animate-[fade_0.25s_ease-out] outline-none"
            key={tab}
          >
            <h2 className="sr-only">{tabs.find((t) => t.id === tab)?.label}</h2>
            {tab === "overview" && <Overview go={select} isAdmin={isAdmin} />}
            {tab === "data" && <DataTab isAdmin={isAdmin} draft={draft} onConsumeDraft={consumeDraft} go={select} />}
            {tab === "quality" && (
              <QualityTab
                onAddAnswer={(q) => {
                  setDraft({
                    title: q.length > 200 ? q.slice(0, 197) + "..." : q,
                    markdown: `Q: ${q}\n\nA: `,
                    key: Date.now(),
                  });
                  select("data");
                }}
              />
            )}
            {tab === "settings" && isAdmin && <SettingsTab onDirty={onDirty} go={select} />}
            {tab === "users" && isAdmin && <UsersTab />}
            {tab === "snapshots" && isAdmin && <SnapshotsTab />}
            {tab === "audit" && isAdmin && <AuditTab />}
          </div>
        </main>

        {pending && (
          <ConfirmDialog
            title="Discard unsaved settings?"
            body="You changed some settings but haven't saved them. If you leave this section they'll be lost."
            confirmLabel="Discard and leave"
            onConfirm={() => {
              const id = pending;
              setPending(null);
              settingsDirty.current = false;
              select(id, true);
            }}
            onCancel={() => setPending(null)}
          />
        )}
      </div>
    </ToastProvider>
  );
}
