import { API_URL, authToken } from "./http";

export { API_URL };

export type Source = { n: number; title: string; url: string; doc_type: string; snippet: string };
export type DoneInfo = { chat_id: number; thread_id: string; outcome: string; latency_ms: number; cache?: string };
/** A soft problem the answer survived (e.g. the AI provider hit its limit). */
export type ChatNotice = {
  kind: string;
  issue?: string;
  where?: string;
  /** passages: answered from the documents only; partial: the model failed mid-answer; message: the bubble already says it */
  mode?: "passages" | "partial" | "message";
  message: string;
  retry_after?: number | null;
};
/** One entry per LangGraph step. */
export type Trace = {
  steps: { node: string; ms: number; info?: Record<string, unknown> }[];
  total_ms?: number;
  cache?: { answer?: string };
};
export type StreamError = { message: string; code?: string; retryAfter?: number | null };

export type StreamHandlers = {
  onToken: (text: string) => void;
  onSources: (sources: Source[]) => void;
  onTitle?: (title: string) => void;
  onSuggestions?: (items: string[]) => void;
  onTrace?: (trace: Trace) => void;
  onNotice?: (notice: ChatNotice) => void;
  onDone: (info: DoneInfo) => void;
  onError: (error: StreamError) => void;
};

/** POST /chat and parse the Server-Sent Events stream (EventSource can't POST). */
export type HistoryItem = { role: "user" | "assistant"; content: string };

export type ChatInput = {
  message: string;
  threadId: string | null;
  history: HistoryItem[];
  quote: string | null;
  wantTitle?: boolean;
  images: { mime: string; data: string }[];
};

export async function streamChat(input: ChatInput, h: StreamHandlers, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken() ? { Authorization: `Bearer ${authToken()}` } : {}),
      },
      body: JSON.stringify({
        message: input.message,
        thread_id: input.threadId,
        history: input.history,
        quote: input.quote,
        want_title: input.wantTitle ?? false,
        images: input.images,
      }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    h.onError({
      message: "Can't reach the server. It may be waking up - please try again in a few seconds.",
      code: "network",
    });
    return;
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after")) || null;
    return h.onError({
      message: "You're asking a little fast - please wait a moment and try again.",
      code: "rate_limited",
      retryAfter,
    });
  }
  if (res.status === 400 || res.status === 422) {
    const detail = await res
      .json()
      .then((j) => (typeof j.detail === "string" ? j.detail : null))
      .catch(() => null);
    return h.onError({ message: detail ?? "That request couldn't be processed. Please try again.", code: "invalid" });
  }
  if (!res.ok || !res.body) return h.onError({ message: "Something went wrong. Please try again.", code: "internal" });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        let event = "message";
        const data: string[] = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (!data.length) continue;
        const payload = JSON.parse(data.join("\n"));
        if (event === "token") h.onToken(payload.text);
        else if (event === "sources") h.onSources(payload.sources);
        else if (event === "title") h.onTitle?.(payload.title);
        else if (event === "suggestions") h.onSuggestions?.(payload.suggestions);
        else if (event === "trace") h.onTrace?.(payload);
        else if (event === "notice") h.onNotice?.(payload);
        else if (event === "done") h.onDone(payload);
        else if (event === "error")
          h.onError({ message: payload.message, code: payload.code, retryAfter: payload.retry_after });
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError")
      h.onError({ message: "The connection was interrupted. Please try again.", code: "network" });
  }
}

export async function sendFeedback(chatId: number, rating: 1 | -1): Promise<void> {
  await fetch(`${API_URL}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, rating }),
  }).catch(() => undefined);
}

/** When the website content was last synced, e.g. "26 Sep 2026". Retries a few times: the API may be waking up. */
export async function fetchDataDate(): Promise<string | null> {
  for (const wait of [0, 2000, 6000, 15000]) {
    await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      const j = await (await fetch(`${API_URL}/health`)).json();
      if (j.data_updated_at) {
        return new Date(j.data_updated_at).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
      }
    } catch {
      /* try again */
    }
  }
  return null;
}

export type ShareSnapshot = {
  title: string;
  messages: {
    role: "user" | "assistant";
    content: string;
    quote?: string;
    sources: Pick<Source, "n" | "title" | "url" | "doc_type">[];
  }[];
};

export async function createShare(snapshot: ShareSnapshot): Promise<{ id: string; delete_token: string }> {
  const res = await fetch(`${API_URL}/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
  });
  if (res.status === 429) throw new Error("Too many share requests - please wait a minute.");
  if (!res.ok) throw new Error("Couldn't create the link. Please try again.");
  return res.json();
}

export async function deleteShare(id: string, token: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/share/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`, {
    method: "DELETE",
  }).catch(() => null);
  return !!res && (res.ok || res.status === 404); // 404 = already gone
}

export async function fetchShare(id: string): Promise<(ShareSnapshot & { created_at: string }) | null> {
  const res = await fetch(`${API_URL}/share/${encodeURIComponent(id)}`).catch(() => null);
  return res && res.ok ? res.json() : null;
}
