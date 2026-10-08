/** Typed helpers for the admin console API (contract: backend/app/api/admin.py and system.py). */
import { API_URL, ApiError, SESSION_EXPIRED, api, authToken, detailOf } from "./http";

export type ProviderName = "llm" | "embedding" | "vision";
export type ProviderState = {
  status: "ok" | "degraded";
  cooldown_s: number;
  errors: Record<string, number>;
  last_error: { kind: string; at: number; hint: string; message: string; ago_s: number } | null;
};
export type Outcomes = Record<string, number>;
export type CacheNamespace = { hit: number; miss: number; error: number; set: number; hit_rate: number | null };
export type Stats = {
  usage: {
    total: number;
    last_24h: number;
    last_7d: number;
    outcomes: Outcomes;
    fallback_rate: number | null;
    degraded_rate: number | null;
    cache_answer_hit_rate: number | null;
    latency_ms: {
      avg: number | null;
      p50: number | null;
      p95: number | null;
      p50_cached: number | null;
      p50_uncached: number | null;
    };
    feedback: { up: number; down: number; positive_rate: number | null };
    top_questions: { question: string; count: number }[];
    unanswered: { question: string; at: string }[];
    by_day: { day: string; chats: number }[];
  };
  cache: { backend: string; entries?: number; circuit_open?: boolean; namespaces: Record<string, CacheNamespace> };
  providers: Record<ProviderName, ProviderState>;
  system: {
    uptime_s: number;
    chunks: number;
    data_updated_at: string | null;
    data_version: string;
    embed_provider: string;
    llm_provider: string;
    llm_model: string;
    store: string;
    cache_backend: string;
    process_latency_ms: { p50: number | null; p95: number | null; samples: number };
  };
};

export type Doc = { url: string; title: string; doc_type: string; chunks: number; updated_at?: string };
export type DocsResponse = { documents: Doc[]; total_chunks: number };

export type JobStatus = "queued" | "running" | "done" | "failed";
export type Job = {
  id: string;
  kind: string;
  title: string;
  actor: string;
  status: JobStatus;
  done: number;
  total: number;
  message: string;
  log: string[];
  error: string | null;
  result: Record<string, unknown>;
  created_at: number; // unix seconds
  finished_at: number | null;
};
export const isActive = (j: Job) => j.status === "queued" || j.status === "running";

export type SettingField = {
  key: string;
  label: string;
  group: string;
  kind: "text" | "select" | "number" | "bool" | "secret" | "textarea";
  help: string;
  options: string[];
  min: number | null;
  max: number | null;
  placeholder: string;
  source: "admin" | "environment";
  value: string | number | boolean;
  is_set?: boolean;
  masked?: string;
};
export type SettingsView = {
  fields: SettingField[];
  index: {
    built_with: string | null;
    current: string;
    stale: boolean;
    chunks: number | null;
    updated_at: string | null;
  };
  info: { store: string; cache: string; embed_dim: number; answer_fingerprint: string };
};
export type TestResult = { ok: boolean; latency_ms: number; model?: string; dim?: number; detail: string };

export type AdminUser = {
  username: string;
  role: "user" | "staff" | "admin";
  display_name: string;
  has_avatar: boolean;
  disabled: boolean;
  created_at: string;
};
export type UsersResponse = { users: AdminUser[]; roles: AdminUser["role"][] };

export type Snapshot = {
  id: string;
  name: string;
  kind: "manual" | "auto" | "uploaded" | string;
  created_at: string;
  actor: string;
  note?: string;
  embed_fingerprint: string;
  dim: number;
  documents: number;
  chunks: number;
  size: number;
  has_settings: boolean;
};
export type SnapshotsResponse = { snapshots: Snapshot[]; current_embed: string };

export type AuditEvent = { ts: string; actor: string; action: string; detail: Record<string, unknown> | null };

/** Sentinel the settings endpoint understands as "remove my override, use the environment default". */
export const CLEAR = "__clear__";
export const DOC_TYPES = [
  "upload",
  "faq",
  "page",
  "programme",
  "funding",
  "post",
  "tribe_events",
  "testimonials",
  "pdf",
] as const;
export const UPLOAD_EXT = [".pdf", ".md", ".markdown", ".txt", ".html", ".htm", ".json"] as const;
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 200 * 1024 * 1024;
export const UOC_URL = "https://cyberjaya.edu.my/";

export const getStats = () => api<Stats>("/admin/stats");
export const getDocuments = () => api<DocsResponse>("/admin/documents");
export const deleteDocument = (url: string) =>
  api<{ removed_chunks: number }>("/admin/documents", { method: "DELETE", json: { url } });
export const addText = (b: { title: string; markdown: string; doc_type: string; url?: string | null }) =>
  api<Job>("/admin/ingest/text", { method: "POST", json: b });
export const reindex = () => api<Job>("/admin/reindex", { method: "POST" });
export const getJobs = () => api<{ jobs: Job[] }>("/admin/jobs").then((r) => r.jobs);

export function uploadFile(file: File, meta: { title?: string; doc_type: string; url?: string }) {
  const form = new FormData();
  form.append("file", file);
  form.append("title", meta.title ?? "");
  form.append("doc_type", meta.doc_type);
  form.append("url", meta.url ?? "");
  return api<Job>("/admin/ingest", { method: "POST", body: form });
}

export const getSettings = () => api<SettingsView>("/admin/settings");
export const saveSettings = (values: Record<string, unknown>) =>
  api<SettingsView>("/admin/settings", { method: "PUT", json: { values } });
export const testConnection = (target: "llm" | "embedding", values: Record<string, unknown>) =>
  api<TestResult>("/admin/settings/test", { method: "POST", json: { target, values } });

export const getUsers = () => api<UsersResponse>("/admin/users");
export const createUser = (b: { username: string; password: string; role: string; display_name: string }) =>
  api<AdminUser>("/admin/users", { method: "POST", json: b });
export const patchUser = (
  username: string,
  patch: Partial<{ role: string; disabled: boolean; new_password: string; display_name: string }>,
) => api<AdminUser>(`/admin/users/${encodeURIComponent(username)}`, { method: "PATCH", json: patch });
export const deleteUser = (username: string) =>
  api<{ ok: true }>(`/admin/users/${encodeURIComponent(username)}`, { method: "DELETE" });

export const getSnapshots = () => api<SnapshotsResponse>("/admin/snapshots");
export const createSnapshot = (name: string, include_settings: boolean) =>
  api<Snapshot>("/admin/snapshots", { method: "POST", json: { name, include_settings } });
export const deleteSnapshot = (id: string) =>
  api<{ ok: true }>(`/admin/snapshots/${encodeURIComponent(id)}`, { method: "DELETE" });
export const restoreSnapshot = (id: string, mode: "exact" | "re_embed", restore_settings: boolean) =>
  api<Job>(`/admin/snapshots/${encodeURIComponent(id)}/restore`, { method: "POST", json: { mode, restore_settings } });
export function uploadSnapshot(file: File, name: string) {
  const form = new FormData();
  form.append("file", file);
  form.append("name", name);
  return api<Snapshot>("/admin/snapshots/upload", { method: "POST", body: form });
}

export const getAudit = () => api<{ events: AuditEvent[] }>("/admin/audit").then((r) => r.events);

/** Authenticated download: the endpoint needs the bearer header, so we can't use a plain link. */
export async function downloadSnapshot(id: string): Promise<void> {
  const token = authToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/admin/snapshots/${encodeURIComponent(id)}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Please try again in a few seconds.");
  }
  if (res.status === 401 && token) window.dispatchEvent(new Event(SESSION_EXPIRED));
  if (!res.ok)
    throw new ApiError(
      res.status,
      detailOf(await res.json().catch(() => null), "The download failed. Please try again."),
    );
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `askuoc-${id}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const errMsg = (e: unknown, fallback = "Something went wrong. Please try again."): string =>
  e instanceof Error ? e.message : fallback;

export const fmtInt = (n: number | null | undefined) => (n == null ? "-" : new Intl.NumberFormat("en").format(n));
export const fmtPct = (r: number | null | undefined, digits = 0) => (r == null ? "-" : `${(r * 100).toFixed(digits)}%`);
export const fmtMs = (ms: number | null | undefined) =>
  ms == null ? "-" : ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s` : `${Math.round(ms)} ms`;

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** "3 min ago" style. Accepts an ISO string or unix seconds. */
export function relTime(when: string | number | null | undefined, now = Date.now()): string {
  if (when == null || when === "") return "-";
  const ms = typeof when === "number" ? when * 1000 : Date.parse(when);
  if (Number.isNaN(ms)) return "-";
  const s = Math.round((now - ms) / 1000);
  if (s < 45) return s < -300 ? "in the future" : "just now"; // small negatives are just clock skew
  const units: [number, string][] = [
    [60, "min"],
    [3600, "hour"],
    [86400, "day"],
    [604800, "week"],
    [2629800, "month"],
    [31557600, "year"],
  ];
  let label = "sec";
  let div = 1;
  for (const [limit, name] of units) {
    if (s < limit) break;
    label = name;
    div = limit;
  }
  const v = Math.floor(s / div);
  return `${v} ${label}${v === 1 ? "" : "s"} ago`;
}

export function fullTime(when: string | number | null | undefined): string {
  if (when == null || when === "") return "";
  const d = new Date(typeof when === "number" ? when * 1000 : when);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const humanize = (s: string) => s.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Friendly reading of a raw provider error from "Test connection" (the server already redacted keys). */
export function classifyProviderError(detail: string): { title: string; hint: string } {
  const t = detail.toLowerCase();
  if (/insufficient_quota|quota|billing|credit balance|resource_exhausted/.test(t))
    return {
      title: "Usage limit reached",
      hint: "The account behind this key is out of quota or credit. Check the provider's plan and billing.",
    };
  if (/429|rate.?limit|too many requests/.test(t))
    return { title: "Rate limited", hint: "The provider is throttling requests. Wait a moment and test again." };
  if (/401|403|unauthori[sz]ed|authentication|api key|api_key|permission denied|forbidden/.test(t))
    return {
      title: "Key rejected",
      hint: "The provider didn't accept the API key. Check it is correct, active and allowed to use this model.",
    };
  if (/404|not found|does not exist|not supported/.test(t))
    return {
      title: "Model or endpoint not found",
      hint: "Check the model name and the API endpoint URL (it usually ends in /v1).",
    };
  if (/timeout|timed out|timeouterror/.test(t))
    return {
      title: "Timed out",
      hint: "The provider took too long to answer. Check the endpoint is reachable and not overloaded.",
    };
  if (/connect|refused|resolve|name or service|network|unreachable|ssl|certificate/.test(t))
    return {
      title: "Can't reach the endpoint",
      hint: "Check the base URL, and that the server is running and reachable from the API.",
    };
  if (/needs \d+/.test(t))
    return {
      title: "Wrong vector size",
      hint: "This model's vectors don't match the index size. Pick a model that supports the required dimensions.",
    };
  return { title: "The provider returned an error", hint: "See the technical detail below." };
}
