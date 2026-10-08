"use client";

import { Archive, ArchiveRestore, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Conversation } from "@/lib/history";

export type MenuAnchor = { rect: DOMRect; align: "left" | "right" };

type Props = {
  conv: Conversation;
  anchor: MenuAnchor;
  onClose: () => void;
  onRename: () => void;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
};

const W = 208;
const H = 224; // estimated menu height, to flip it above the button near the bottom edge

/** The "..." menu: Pin, Archive, Delete, positioned next to the button that opened it. */
export default function ChatMenu({ conv, anchor, onClose, onRename, onPin, onArchive, onDelete }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const { rect, align } = anchor;
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const left = Math.max(8, Math.min(align === "right" ? rect.right - W : rect.left, vw - W - 8));
  const top = rect.bottom + 6 + H > vh ? Math.max(8, rect.top - H - 6) : rect.bottom + 6;

  const item =
    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-uoc-50 dark:hover:bg-uoc-800";
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <div
      ref={ref}
      role="menu"
      style={{ top, left, width: W }}
      className="glass-strong fixed z-50 animate-pop rounded-2xl p-1.5"
    >
      <button role="menuitem" onClick={run(onRename)} className={item}>
        <Pencil className="h-[18px] w-[18px]" /> Rename
      </button>
      <button role="menuitem" onClick={run(onPin)} className={item}>
        {conv.pinned ? <PinOff className="h-[18px] w-[18px]" /> : <Pin className="h-[18px] w-[18px]" />}
        {conv.pinned ? "Unpin" : "Pin"}
      </button>
      <div className="mx-2 my-1 h-px bg-uoc-100 dark:bg-uoc-800" />
      <button role="menuitem" onClick={run(onArchive)} className={item}>
        {conv.archived ? <ArchiveRestore className="h-[18px] w-[18px]" /> : <Archive className="h-[18px] w-[18px]" />}
        {conv.archived ? "Unarchive" : "Archive"}
      </button>
      <button
        role="menuitem"
        onClick={run(onDelete)}
        className={`${item} !text-red-600 hover:!bg-red-50 dark:!text-red-400 dark:hover:!bg-red-950/40`}
      >
        <Trash2 className="h-[18px] w-[18px]" /> Delete
      </button>
    </div>
  );
}
