/** Shared API client: attaches the session token and turns failures into readable errors. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const SESSION_KEY = "askuoc_session_v1";

export type PublicUser = {
  username: string;
  role: "user" | "staff" | "admin";
  display_name: string;
  has_avatar?: boolean;
  disabled?: boolean;
  created_at?: string | null;
};
export type Session = { token: string; user: PublicUser };

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
export function saveSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode: the session won't survive a reload */
  }
}
export const authToken = () => loadSession()?.token ?? null;

/** Fired when the server rejects our token (expired, password changed, account disabled). */
export const SESSION_EXPIRED = "askuoc:session-expired";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter: number | null = null,
  ) {
    super(message);
  }
}

/** FastAPI errors are `{detail: string}` or, for validation, `{detail: [{msg, loc}]}`. */
export function detailOf(body: unknown, fallback: string): string {
  const d = (body as { detail?: unknown } | null)?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d.length) {
    const first = d[0] as { msg?: string; loc?: unknown[] };
    const field = Array.isArray(first.loc) ? String(first.loc[first.loc.length - 1]) : "";
    return `${field ? field + ": " : ""}${first.msg ?? fallback}`;
  }
  return fallback;
}

type Opts = Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit; auth?: boolean };

/** JSON request. Throws ApiError on non-2xx. `auth: false` skips the token. */
export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const { json, auth = true, headers, ...rest } = opts;
  const h = new Headers(headers);
  if (json !== undefined) h.set("Content-Type", "application/json");
  const token = auth ? authToken() : null;
  if (token) h.set("Authorization", `Bearer ${token}`);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: h,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. It may be waking up - please try again in a few seconds.");
  }
  if (res.status === 401 && token && typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EXPIRED));
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const retry = Number(res.headers.get("retry-after")) || null;
    throw new ApiError(
      res.status,
      detailOf(
        body,
        res.status === 429 ? "Too many requests - please wait a moment." : "Something went wrong. Please try again.",
      ),
      retry,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json().catch(() => undefined)) as T;
}
