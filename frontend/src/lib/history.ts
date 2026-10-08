import type { Source, Trace } from "./api";

export type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  quote?: string; // earlier answer text this message replies to
  images?: { thumb: string; label?: string }[]; // attachment thumbnails
  image?: string; // legacy single-thumbnail field
  sources: Source[];
  at?: number; // when the message was sent (ms)
  chatId?: number;
  rating?: 1 | -1;
  error?: boolean;
  suggestions?: string[];
  trace?: Trace;
  degraded?: { message: string; issue?: string; retryAt?: number }; // answered without the AI model (e.g. quota hit)
};

export type Conversation = {
  id: string;
  title: string;
  threadId: string | null;
  messages: Msg[];
  updatedAt: number;
  pinned?: boolean;
  archived?: boolean;
  titleLocked?: boolean; // user renamed it: never overwrite
};

const KEY = "askuoc_history_v1";
const MAX_CONVERSATIONS = 30;

export const uid = () => Math.random().toString(36).slice(2, 10);

export function loadHistory(): Conversation[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    // older saved chats: keep the wording consistent with today's replies
    return JSON.parse(raw.replace(/an unofficial assistant/gi, "your assistant")) as Conversation[];
  } catch {
    return [];
  }
}

export function saveHistory(convs: Conversation[]): void {
  try {
    const trimmed = [...convs].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS);
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* storage full or unavailable: history is best-effort */
  }
}

export const titleFrom = (text: string) => (text.length > 44 ? text.slice(0, 44).trimEnd() + "…" : text);

/** Sidebar group for a conversation's last activity. */
export function groupLabel(ts: number): string {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const days = Math.floor((startOfToday - new Date(ts).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 8) return "Previous 7 days";
  return "Older";
}

/** "10:42" today, "26 Sep, 10:42" earlier this year, "26 Sep 2025, 10:42" before that. */
export function formatWhen(ts: number): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return time;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${date}, ${time}`;
}
