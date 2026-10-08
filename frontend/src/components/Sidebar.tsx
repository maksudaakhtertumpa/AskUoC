"use client";

import {
  Archive,
  GraduationCap,
  History,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Search,
  SquarePen,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { type Conversation, formatWhen, groupLabel } from "@/lib/history";
import ChatMenu, { type MenuAnchor } from "./ChatMenu";
import type { SyncState } from "@/lib/useSync";
import AccountMenu from "./AccountMenu";
import LegalLinks from "./site/LegalLinks";
import Tip from "./Tip";

type Props = {
  convs: Conversation[];
  activeId: string | null;
  open: boolean; // expanded (desktop) or drawer visible (mobile)
  onOpen: () => void;
  onClose: () => void;
  onNavigate: () => void; // closes the drawer on mobile only
  onSelect: (id: string) => void;
  onNew: () => void;
  onSearch: () => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void; // asks for confirmation upstream
  onClearAll: () => void; // asks for confirmation upstream
  onOpenArchived: () => void;
  syncState: SyncState;
  onSignIn: () => void;
  onSignOut: () => void; // asks for confirmation upstream
};

const railBtn =
  "flex h-10 w-10 items-center justify-center rounded-xl text-uoc-700 transition hover:bg-uoc-100/80 active:scale-95 dark:text-uoc-200 dark:hover:bg-uoc-800/70";
const rowBtn =
  "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] text-slate-700 transition hover:bg-uoc-100/70 active:scale-[0.99] dark:text-slate-200 dark:hover:bg-uoc-800/60 md:py-2.5 md:text-sm";

const byRecent = (a: Conversation, b: Conversation) => b.updatedAt - a.updatedAt;

export default function Sidebar(p: Props) {
  const live = p.convs.filter((c) => !c.archived);
  const pinned = live.filter((c) => c.pinned).sort(byRecent);
  const recents = live.filter((c) => !c.pinned).sort(byRecent);
  const archivedCount = p.convs.length - live.length;
  const railList = [...pinned, ...recents];

  const [popover, setPopover] = useState<{ top: number; left: number } | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: MenuAnchor } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const recentsBtnRef = useRef<HTMLButtonElement>(null);

  // close the Recents popover on outside click / Escape
  useEffect(() => {
    if (!popover) return;
    const down = (e: MouseEvent) => {
      const target = e.target as Node;
      // the Recents button toggles the popover itself; closing here as well would make the click reopen it
      if (popRef.current?.contains(target) || recentsBtnRef.current?.contains(target)) return;
      setPopover(null);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setPopover(null);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [popover]);

  // clicking any empty part of the sidebar (not a button/link/row) toggles it
  const onAsideClick = (e: ReactMouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button, a, input, li, kbd")) return;
    if (p.open) p.onClose();
    else p.onOpen();
  };

  const pick = (id: string) => {
    p.onSelect(id);
    p.onNavigate();
    setPopover(null);
  };

  const menuConv = menu ? p.convs.find((c) => c.id === menu.id) : undefined;

  const commitRename = (id: string, value: string) => {
    setEditingId(null);
    const t = value.trim();
    if (t) p.onRename(id, t);
  };

  const row = (c: Conversation) => (
    <li key={c.id} className="group relative animate-rise">
      {editingId === c.id ? (
        <div className="flex items-center gap-2.5 rounded-xl bg-white/70 px-3 py-2 ring-2 ring-uoc-400/50 dark:bg-white/10">
          <MessageSquare className="h-4 w-4 shrink-0 text-uoc-400" />
          <input
            autoFocus
            defaultValue={c.title}
            maxLength={60}
            aria-label="Chat title"
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename(c.id, e.currentTarget.value);
              else if (e.key === "Escape") setEditingId(null);
            }}
            onBlur={(e) => editingId === c.id && commitRename(c.id, e.currentTarget.value)}
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none md:text-sm"
          />
        </div>
      ) : (
        <>
          <button
            onClick={() => pick(c.id)}
            onDoubleClick={() => setEditingId(c.id)}
            title={`${c.title} · ${formatWhen(c.updatedAt)}`}
            className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-3 pr-11 text-left text-[15px] transition md:py-2.5 md:text-sm ${
              c.id === p.activeId
                ? "bg-uoc-100/80 font-medium text-uoc-800 dark:bg-uoc-800/70 dark:text-uoc-50"
                : "hover:bg-white/50 dark:hover:bg-white/10"
            }`}
          >
            {c.pinned ? (
              <Pin className="h-4 w-4 shrink-0 -rotate-45 text-magenta-500" aria-label="Pinned" />
            ) : (
              <MessageSquare className={`h-4 w-4 shrink-0 ${c.id === p.activeId ? "text-uoc-500" : "text-uoc-400"}`} />
            )}
            <span className="truncate">{c.title}</span>
          </button>
          <button
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setMenu({ id: c.id, anchor: { rect, align: "left" } });
            }}
            aria-label={`Options for: ${c.title}`}
            aria-haspopup="menu"
            className={`absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/60 hover:text-uoc-700 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-80 dark:hover:bg-white/10 ${
              menu?.id === c.id ? "bg-white/60 opacity-100 dark:bg-white/10" : "opacity-0"
            }`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </>
      )}
    </li>
  );

  const heading = (text: string) => (
    <h2 className="px-5 pb-1 pt-5 text-xs font-semibold uppercase tracking-wide text-uoc-400">{text}</h2>
  );

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-uoc-950/50 backdrop-blur-[2px] transition-opacity duration-300 md:hidden ${p.open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={p.onClose}
        aria-hidden
      />

      {/* mobile: slide-in drawer; desktop: full sidebar or icon rail when collapsed */}
      <aside
        aria-label="Chat history"
        onClick={onAsideClick}
        className={`${p.open ? "md:cursor-w-resize" : "md:cursor-e-resize"} glass-side fixed inset-y-0 left-0 z-40 shrink-0 overflow-hidden pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-2xl transition-[transform,width] duration-300 ease-out md:static md:z-auto md:translate-x-0 md:pb-0 md:pt-0 md:shadow-none ${
          p.open
            ? "w-[86vw] max-w-[20rem] translate-x-0 md:w-72"
            : "w-[86vw] max-w-[20rem] -translate-x-full md:w-[52px]"
        }`}
      >
        {p.open ? (
          <div className="flex h-full w-[86vw] max-w-[20rem] animate-[fade_0.25s_ease-out] flex-col md:w-72">
            <div className="flex items-center justify-between px-3 pb-1 pt-3">
              <div className="flex items-center gap-2 px-1 text-base font-semibold text-uoc-800 dark:text-uoc-100">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-uoc-600 to-magenta-500 text-white shadow-md shadow-uoc-600/25">
                  <GraduationCap className="h-4 w-4" />
                </span>
                AskUoC
              </div>
              <Tip label="Close sidebar" side="bottom">
                <button onClick={p.onClose} aria-label="Close sidebar" className={railBtn}>
                  <PanelLeftClose className="h-[18px] w-[18px]" />
                </button>
              </Tip>
            </div>

            <div className="space-y-1 px-2 pt-3">
              <button
                onClick={() => {
                  p.onNew();
                  p.onNavigate();
                }}
                className={`${rowBtn} bg-gradient-to-r from-uoc-600 to-magenta-500 font-medium !text-white shadow-md shadow-uoc-600/20 hover:brightness-110`}
              >
                <SquarePen className="h-[18px] w-[18px]" /> New chat
              </button>
              <button onClick={p.onSearch} className={rowBtn}>
                <Search className="h-[18px] w-[18px] text-uoc-500" /> Search chats
                <kbd className="ml-auto hidden rounded-md border border-uoc-100 px-1.5 py-0.5 text-[10px] text-slate-400 md:block dark:border-uoc-800">
                  Ctrl K
                </kbd>
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-2 pb-2">
              {pinned.length > 0 && (
                <>
                  {heading("Pinned")}
                  <ul>{pinned.map(row)}</ul>
                </>
              )}
              {recents.length === 0 && (
                <>
                  {heading("Recents")}
                  {pinned.length === 0 && (
                    <p className="px-3 py-3 text-xs text-slate-400">Your conversations will appear here.</p>
                  )}
                </>
              )}
              {["Today", "Yesterday", "Previous 7 days", "Older"].map((label) => {
                const group = recents.filter((c) => groupLabel(c.updatedAt) === label);
                return group.length ? (
                  <div key={label}>
                    {heading(label)}
                    <ul>{group.map(row)}</ul>
                  </div>
                ) : null;
              })}
            </nav>

            <div className="space-y-0.5 border-t border-white/50 p-2 dark:border-white/10">
              {(archivedCount > 0 || live.length > 0) && (
                <>
                  {archivedCount > 0 && (
                    <button onClick={p.onOpenArchived} className={rowBtn}>
                      <Archive className="h-[18px] w-[18px] text-uoc-500" /> Archived chats
                      <span className="ml-auto rounded-full bg-uoc-100 px-2 py-0.5 text-[11px] font-medium text-uoc-700 dark:bg-uoc-800 dark:text-uoc-200">
                        {archivedCount}
                      </span>
                    </button>
                  )}
                  <button
                    onClick={p.onClearAll}
                    aria-label="Clear all history"
                    className={`${rowBtn} hover:!bg-magenta-50 hover:!text-magenta-600 dark:hover:!bg-magenta-950/40`}
                  >
                    <Trash2 className="h-[18px] w-[18px]" /> Clear history
                  </button>
                </>
              )}
              <AccountMenu
                collapsed={false}
                syncState={p.syncState}
                onSignIn={p.onSignIn}
                onSignOut={p.onSignOut}
                onNavigate={p.onNavigate}
              />
              <LegalLinks size="xs" className="pt-1" />
            </div>
          </div>
        ) : (
          <div className="hidden h-full w-[52px] animate-[fade_0.25s_ease-out] flex-col items-center gap-1 py-3 md:flex">
            {/* the logo turns into the "open sidebar" icon on hover */}
            <Tip label="Open sidebar" side="right">
              <button onClick={p.onOpen} aria-label="Open sidebar" className={`${railBtn} group relative`}>
                <span className="absolute inset-0 flex items-center justify-center transition duration-200 group-hover:scale-50 group-hover:opacity-0 group-focus-visible:scale-50 group-focus-visible:opacity-0">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-uoc-600 to-magenta-500 text-white shadow-md shadow-uoc-600/25">
                    <GraduationCap className="h-4 w-4" />
                  </span>
                </span>
                <PanelLeftOpen className="absolute h-[18px] w-[18px] scale-50 opacity-0 transition duration-200 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100" />
              </button>
            </Tip>
            <div className="mt-2 flex flex-col items-center gap-1">
              <Tip label="New chat" side="right">
                <button onClick={p.onNew} aria-label="New chat" className={railBtn}>
                  <SquarePen className="h-[18px] w-[18px]" />
                </button>
              </Tip>
              <Tip label="Search chats" side="right">
                <button onClick={p.onSearch} aria-label="Search chats" className={railBtn}>
                  <Search className="h-[18px] w-[18px]" />
                </button>
              </Tip>
              <Tip label="Recents" side="right">
                <button
                  ref={recentsBtnRef}
                  aria-label="Recent chats"
                  aria-expanded={popover !== null}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setPopover(popover ? null : { top: r.top - 8, left: r.right + 8 });
                  }}
                  className={`${railBtn} ${popover ? "bg-uoc-100/80 dark:bg-uoc-800" : ""}`}
                >
                  <History className="h-[18px] w-[18px]" />
                </button>
              </Tip>
            </div>
            {/* the bin stays reachable when the sidebar is collapsed */}
            <div className="mt-auto flex flex-col items-center gap-1">
              {p.convs.length > 0 && (
                <>
                  {archivedCount > 0 && (
                    <Tip label={`Archived chats (${archivedCount})`} side="right">
                      <button onClick={p.onOpenArchived} aria-label="Archived chats" className={`${railBtn} relative`}>
                        <Archive className="h-[18px] w-[18px]" />
                        <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-magenta-500 px-1 text-[9px] font-semibold text-white">
                          {archivedCount}
                        </span>
                      </button>
                    </Tip>
                  )}
                  <Tip label="Clear history" side="right">
                    <button
                      onClick={p.onClearAll}
                      aria-label="Clear all history"
                      className={`${railBtn} hover:!bg-magenta-50 hover:!text-magenta-600 dark:hover:!bg-magenta-950/40`}
                    >
                      <Trash2 className="h-[18px] w-[18px]" />
                    </button>
                  </Tip>
                </>
              )}
              <AccountMenu
                collapsed
                syncState={p.syncState}
                onSignIn={p.onSignIn}
                onSignOut={p.onSignOut}
                onNavigate={p.onNavigate}
              />
            </div>
          </div>
        )}
      </aside>

      {popover && (
        <div
          ref={popRef}
          style={{ top: popover.top, left: popover.left }}
          className="glass-strong fixed z-50 hidden max-h-[70vh] w-64 animate-pop overflow-y-auto rounded-2xl p-1.5 md:block"
        >
          <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-uoc-400">Recents</p>
          {railList.length === 0 && <p className="px-3 py-3 text-xs text-slate-400">No conversations yet.</p>}
          {railList.slice(0, 12).map((c) => (
            <button
              key={c.id}
              onClick={() => pick(c.id)}
              className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-uoc-50 dark:hover:bg-uoc-800 ${c.id === p.activeId ? "bg-uoc-50 dark:bg-uoc-800" : ""}`}
            >
              {c.pinned ? (
                <Pin className="h-3.5 w-3.5 shrink-0 -rotate-45 text-magenta-500" />
              ) : (
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-uoc-400" />
              )}
              <span className="truncate">{c.title}</span>
            </button>
          ))}
        </div>
      )}

      {menu && menuConv && (
        <ChatMenu
          conv={menuConv}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          onRename={() => setEditingId(menuConv.id)}
          onPin={() => p.onPin(menuConv.id)}
          onArchive={() => p.onArchive(menuConv.id)}
          onDelete={() => p.onDelete(menuConv.id)}
        />
      )}
    </>
  );
}
