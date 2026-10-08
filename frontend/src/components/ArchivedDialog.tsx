"use client";

import { Archive, ArchiveRestore, Trash2, X } from "lucide-react";
import { useEffect } from "react";
import type { Conversation } from "@/lib/history";

type Props = {
  convs: Conversation[];
  onOpen: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

export default function ArchivedDialog({ convs, onOpen, onRestore, onDelete, onClose }: Props) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  const sorted = [...convs].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Archived chats"
    >
      <div
        className="absolute inset-0 animate-[fade_0.15s_ease-out] bg-uoc-950/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div className="glass-strong relative flex max-h-[80vh] w-full max-w-md animate-pop flex-col overflow-hidden rounded-3xl">
        <div className="flex items-center justify-between border-b border-uoc-100 px-5 py-4 dark:border-uoc-800">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Archive className="h-4 w-4 text-uoc-500" /> Archived chats
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-uoc-50 dark:hover:bg-uoc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto p-2">
          {sorted.length === 0 && <li className="px-3 py-10 text-center text-sm text-slate-400">No archived chats.</li>}
          {sorted.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-1 rounded-xl px-2 py-1 hover:bg-uoc-50 dark:hover:bg-uoc-800/60"
            >
              <button
                onClick={() => {
                  onOpen(c.id);
                  onClose();
                }}
                className="min-w-0 flex-1 truncate rounded-lg px-2 py-2.5 text-left text-sm"
              >
                {c.title}
              </button>
              <button
                onClick={() => onRestore(c.id)}
                aria-label={`Unarchive: ${c.title}`}
                title="Unarchive"
                className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-uoc-600 dark:hover:bg-uoc-700"
              >
                <ArchiveRestore className="h-4 w-4" />
              </button>
              <button
                onClick={() => onDelete(c.id)}
                aria-label={`Delete: ${c.title}`}
                title="Delete"
                className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
