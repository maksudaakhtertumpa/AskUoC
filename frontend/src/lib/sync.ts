import { ApiError, api } from "./http";
import type { Conversation } from "./history";

const MAX_BYTES = 190_000; // the API rejects a single conversation above 200 KB
const BATCH = 20;

type Remote = { id: string; updated_at: number; data: Omit<Conversation, "id" | "updatedAt"> };

/** What we upload: no image thumbnails (bulky, and attachments are never stored server-side), oldest turns dropped if still too big. */
export function toRemote(c: Conversation): Remote {
  const strip = (messages: Conversation["messages"]) =>
    messages.map(({ images, image, ...m }) => (void images, void image, m));
  let messages = strip(c.messages);
  const build = (): Remote => ({
    id: c.id,
    updated_at: c.updatedAt,
    data: {
      title: c.title,
      threadId: c.threadId,
      messages,
      pinned: c.pinned,
      archived: c.archived,
      titleLocked: c.titleLocked,
    },
  });
  let out = build();
  while (JSON.stringify(out).length > MAX_BYTES && messages.length > 2) {
    messages = messages.slice(2);
    out = build();
  }
  return out;
}

const fromRemote = (r: Remote): Conversation => ({ ...(r.data as Conversation), id: r.id, updatedAt: r.updated_at });

export async function pull(): Promise<Conversation[]> {
  const res = await api<{ conversations: Remote[] }>("/me/conversations");
  return res.conversations.map(fromRemote);
}

/** Last write wins per conversation. Returns the merged list and the ones the server is missing or has an older copy of. */
export function merge(
  local: Conversation[],
  remote: Conversation[],
): { merged: Conversation[]; toPush: Conversation[] } {
  const byId = new Map(remote.map((c) => [c.id, c]));
  const toPush: Conversation[] = [];
  for (const c of local) {
    const r = byId.get(c.id);
    if (!r || c.updatedAt > r.updatedAt) {
      byId.set(c.id, c);
      if (c.messages.length) toPush.push(c);
    }
  }
  return { merged: [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt), toPush };
}

export async function push(items: Conversation[]): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH) {
    try {
      await api("/me/conversations", {
        method: "PUT",
        json: { conversations: items.slice(i, i + BATCH).map(toRemote) },
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 413) continue; // one oversized chat must not block the rest
      throw e;
    }
  }
}

export const removeRemote = (id: string) =>
  api(`/me/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
export const removeAllRemote = () => api("/me/conversations", { method: "DELETE" }).catch(() => undefined);
