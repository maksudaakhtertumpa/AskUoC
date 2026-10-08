"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";

type Props = {
  title: string;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onCommit: (title: string) => void;
};

/** The conversation title; click to rename (Enter saves, Esc cancels). */
export default function ChatTitle({ title, editing, onEditingChange, onCommit }: Props) {
  const [draft, setDraft] = useState(title);

  const finish = (save: boolean) => {
    onEditingChange(false);
    if (save && draft.trim() && draft.trim() !== title) onCommit(draft.trim());
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        maxLength={60}
        aria-label="Chat title"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          else if (e.key === "Escape") finish(false);
        }}
        onBlur={() => finish(true)}
        className="glass h-10 w-full min-w-0 max-w-sm rounded-xl px-3 text-base font-medium outline-none ring-2 ring-uoc-400/50 md:text-sm"
      />
    );
  }

  return (
    <button
      onClick={() => {
        setDraft(title);
        onEditingChange(true);
      }}
      title="Rename chat"
      className="group flex h-10 min-w-0 max-w-full items-center gap-2 rounded-xl px-3 text-sm font-medium text-slate-700 transition hover:bg-white/50 dark:text-slate-200 dark:hover:bg-white/10 md:max-w-md"
    >
      <span className="truncate">{title}</span>
      <Pencil className="h-3.5 w-3.5 shrink-0 opacity-0 transition group-hover:opacity-60 [@media(hover:none)]:opacity-40" />
    </button>
  );
}
