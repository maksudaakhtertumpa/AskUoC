"use client";

import {
  BrainCircuit,
  CheckCircle2,
  Gauge,
  KeyRound,
  Lock,
  MessageSquareText,
  Plug,
  RotateCcw,
  Save,
  ScanSearch,
  XCircle,
  Zap,
} from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/http";
import {
  CLEAR,
  classifyProviderError,
  errMsg,
  fmtMs,
  getSettings,
  saveSettings,
  testConnection,
  type SettingField,
  type SettingsView,
  type TestResult,
} from "@/lib/admin";
import type { TabId } from "./tabs";
import {
  Card,
  Chip,
  Note,
  SectionTitle,
  Skeleton,
  Spinner,
  Switch,
  btnGhost,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  useResource,
  useToast,
} from "./ui";

type Vals = Record<string, string | boolean>;
const GROUPS: Record<string, { icon: ReactNode; blurb: string; test?: "llm" | "embedding" }> = {
  "Language model": {
    icon: <BrainCircuit className="h-4 w-4" />,
    blurb: "The AI that writes the answers.",
    test: "llm",
  },
  Embeddings: {
    icon: <ScanSearch className="h-4 w-4" />,
    blurb: "How the assistant searches. Changing the model means re-embedding your data.",
    test: "embedding",
  },
  Retrieval: {
    icon: <Gauge className="h-4 w-4" />,
    blurb: "How much the assistant reads before answering, and when it should admit it doesn't know.",
  },
  Behaviour: { icon: <MessageSquareText className="h-4 w-4" />, blurb: "Tone, contact link and who can sign up." },
  "Limits & cache": {
    icon: <Zap className="h-4 w-4" />,
    blurb: "Protects your quota and keeps repeat questions fast.",
  },
};
const RATIO_KEYS = new Set(["min_coverage", "min_similarity"]);

/** Which fields matter for the current provider choices (hidden ones keep their saved values). */
function visible(key: string, get: (k: string) => string | boolean): boolean {
  const llm = get("llm_provider");
  const emb = get("embed_provider");
  switch (key) {
    case "gemini_llm_model":
      return llm === "gemini";
    case "llm_base_url":
    case "openai_llm_model":
    case "llm_api_key":
      return llm === "openai_compatible";
    case "google_api_key":
      return llm === "gemini" || emb === "gemini";
    case "gemini_embed_model":
      return emb === "gemini";
    case "embed_base_url":
    case "openai_embed_model":
    case "embed_api_key":
      return emb === "openai_compatible";
    default:
      return true;
  }
}

/** Mirrors the server's rules so people get instant, field-level messages. The server re-checks everything. */
function validate(f: SettingField, v: string | boolean): string | null {
  if (f.kind === "number") {
    const s = String(v).trim();
    if (s === "") return "Enter a number.";
    const n = Number(s);
    if (!Number.isFinite(n)) return "Enter a number.";
    if (!RATIO_KEYS.has(f.key) && !Number.isInteger(n)) return "Use a whole number.";
    if ((f.min != null && n < f.min) || (f.max != null && n > f.max)) return `Must be between ${f.min} and ${f.max}.`;
  } else if (f.key.endsWith("_base_url")) {
    const s = String(v).trim();
    if (s && !/^https?:\/\//.test(s)) return "Must start with http:// or https://";
  } else if (f.key === "system_prompt_extra" && String(v).length > 1500) {
    return "Limited to 1500 characters.";
  } else if (f.key === "rate_limit" && !String(v).trim()) {
    return "Required, e.g. 20/minute.";
  }
  return null;
}

function omit<T>(o: Record<string, T>, key: string): Record<string, T> {
  const copy = { ...o };
  delete copy[key];
  return copy;
}

const originalOf = (f: SettingField): string | boolean =>
  f.kind === "bool" ? Boolean(f.value) : String(f.value ?? "");

export default function SettingsTab({ onDirty, go }: { onDirty: (dirty: boolean) => void; go: (t: TabId) => void }) {
  const toast = useToast();
  const res = useResource(getSettings);
  const view = res.data;
  const [edits, setEdits] = useState<Vals>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [resets, setResets] = useState<Record<string, true>>({}); // "use the environment default" (also clears a saved key)
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<{ text: string; key: string | null } | null>(null);
  const [tests, setTests] = useState<Partial<Record<"llm" | "embedding", TestResult | "running">>>({});

  const fields = useMemo(() => view?.fields ?? [], [view]);
  const byKey = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f])), [fields]);
  const get = (k: string): string | boolean => (k in edits ? edits[k] : byKey[k] ? originalOf(byKey[k]) : "");

  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const k of Object.keys(edits)) {
      const f = byKey[k];
      const e = f && validate(f, edits[k]);
      if (e) out[k] = e;
    }
    return out;
  }, [edits, byKey]);

  const dirtyKeys = useMemo(
    () => [
      ...new Set([...Object.keys(edits), ...Object.keys(secrets).filter((k) => secrets[k]), ...Object.keys(resets)]),
    ],
    [edits, secrets, resets],
  );
  const dirty = dirtyKeys.length > 0;

  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const setEdit = (f: SettingField, v: string | boolean) => {
    setServerError(null);
    setResets((c) => omit(c, f.key));
    setEdits((cur) => {
      const rest = omit(cur, f.key);
      return v === originalOf(f) ? rest : { ...rest, [f.key]: v };
    });
  };
  const setSecret = (key: string, v: string) => {
    setServerError(null);
    setSecrets((c) => ({ ...c, [key]: v }));
  };
  const undo = (key: string) => {
    setEdits((c) => omit(c, key));
    setSecrets((c) => omit(c, key));
    setResets((c) => omit(c, key));
    setServerError(null);
  };
  const discard = () => (setEdits({}), setSecrets({}), setResets({}), setServerError(null));

  /** Only what changed goes to the server: blank secrets are never sent, so saved keys stay untouched. */
  const payload = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(edits)) out[k] = byKey[k]?.kind === "number" ? Number(v) : v;
    for (const [k, v] of Object.entries(secrets)) if (v.trim()) out[k] = v.trim();
    for (const k of Object.keys(resets)) out[k] = CLEAR;
    return out;
  };

  const blame = (msg: string, values: Record<string, unknown>): string | null => {
    const keys = Object.keys(values);
    const hit = keys.find((k) => msg.includes(`'${k}'`));
    if (hit) return hit;
    const cands = keys.filter((k) => byKey[k] && msg.startsWith(byKey[k].label));
    if (cands.length <= 1) return cands[0] ?? null;
    return cands.find((k) => byKey[k].options.length && byKey[k].options.every((o) => msg.includes(o))) ?? null;
  };

  const save = async () => {
    if (Object.keys(errors).length) {
      toast.error("Some values need fixing first - they're highlighted below.");
      return;
    }
    const values = payload();
    setSaving(true);
    setServerError(null);
    try {
      const next = await saveSettings(values);
      res.mutate(next);
      discard();
      setTests({});
      toast.success("Settings saved and applied. No restart needed.");
    } catch (e) {
      const text = errMsg(e);
      setServerError({ text, key: e instanceof ApiError && e.status === 422 ? blame(text, values) : null });
      toast.error(e instanceof ApiError && e.status === 422 ? "The server rejected some values." : text);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (target: "llm" | "embedding") => {
    setTests((t) => ({ ...t, [target]: "running" }));
    try {
      const r = await testConnection(target, payload());
      setTests((t) => ({ ...t, [target]: r }));
    } catch (e) {
      setTests((t) => ({ ...t, [target]: { ok: false, latency_ms: 0, detail: errMsg(e) } }));
    }
  };

  if (!view) {
    return res.error ? (
      <Note
        kind="error"
        title="Couldn't load settings"
        action={
          <button className={btnSecondary} onClick={() => void res.reload()}>
            Try again
          </button>
        }
      >
        {res.error.message}
      </Note>
    ) : (
      <div className="space-y-4" aria-busy="true" aria-label="Loading settings">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-56" />
        ))}
      </div>
    );
  }

  const groups = [...new Set(fields.map((f) => f.group))];
  const errCount = Object.keys(errors).length;

  return (
    <div className="space-y-4 pb-2">
      <Note kind="info" title="Changes apply live">
        Saving updates the running assistant straight away, no restart. API keys are <b>encrypted on the server</b>{" "}
        before they are stored and are never sent back to your browser - only whether one is saved.
      </Note>
      {view.index.stale && (
        <Note
          kind="warn"
          role="alert"
          title="Search index needs re-embedding"
          action={
            <button onClick={() => go("data")} className={btnPrimary}>
              Go to Data
            </button>
          }
        >
          Stored passages were embedded with{" "}
          <code className="rounded bg-black/5 px-1 dark:bg-white/10">{view.index.built_with}</code>; the assistant now
          uses <code className="rounded bg-black/5 px-1 dark:bg-white/10">{view.index.current}</code>.
        </Note>
      )}
      <InfoStrip info={view.info} index={view.index} />

      {groups.map((g) => {
        const meta = GROUPS[g] ?? { icon: <Plug className="h-4 w-4" />, blurb: "" };
        const list = fields.filter((f) => f.group === g && visible(f.key, get));
        const testable = meta.test;
        const t = testable ? tests[testable] : undefined;
        return (
          <Card key={g} aria-labelledby={`grp-${g}`}>
            <SectionTitle id={`grp-${g}`} icon={meta.icon} title={g} hint={meta.blurb} />
            <div className="grid gap-x-5 gap-y-5 md:grid-cols-2">
              {list.map((f) => (
                <FieldRow
                  key={f.key}
                  f={f}
                  value={get(f.key)}
                  secret={secrets[f.key]}
                  reset={f.key in resets}
                  dirty={f.key in edits || Boolean(secrets[f.key]) || f.key in resets}
                  error={errors[f.key] ?? (serverError?.key === f.key ? serverError.text : null)}
                  onChange={(v) => setEdit(f, v)}
                  onSecret={(v) => setSecret(f.key, v)}
                  onReset={() => {
                    setResets((r) => ({ ...r, [f.key]: true }));
                    setEdits((c) => omit(c, f.key));
                    setSecrets((c) => omit(c, f.key));
                  }}
                  onUndo={() => undo(f.key)}
                />
              ))}
            </div>
            {list.length === 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400">Nothing to configure for this choice.</p>
            )}
            {testable && (
              <div className="mt-5 border-t border-uoc-100/80 pt-4 dark:border-white/10">
                <div className="flex flex-wrap items-center gap-3">
                  <button onClick={() => void runTest(testable)} disabled={t === "running"} className={btnSecondary}>
                    {t === "running" ? <Spinner /> : <Plug aria-hidden className="h-4 w-4" />} Test{" "}
                    {testable === "llm" ? "language model" : "embeddings"}
                  </button>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Sends one tiny request using the values in this form - nothing is saved.
                  </p>
                </div>
                <TestOutcome result={t} />
              </div>
            )}
          </Card>
        );
      })}

      {serverError && !serverError.key && (
        <Note kind="error" title="Couldn't save">
          {serverError.text}
        </Note>
      )}

      {dirty && (
        <div className="sticky bottom-3 z-30 animate-rise" role="region" aria-label="Unsaved changes">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-2xl border border-uoc-200 bg-white/95 px-4 py-3 shadow-2xl shadow-uoc-900/25 backdrop-blur-xl dark:border-uoc-700 dark:bg-uoc-900/95">
            <p className="min-w-0 flex-1 text-sm" aria-live="polite">
              <b>{dirtyKeys.length}</b> unsaved change{dirtyKeys.length > 1 ? "s" : ""}
              {errCount > 0 && <span className="ml-2 text-red-600 dark:text-red-300">- {errCount} to fix</span>}
            </p>
            <button onClick={discard} disabled={saving} className={btnGhost}>
              Discard
            </button>
            <button onClick={() => void save()} disabled={saving || errCount > 0} className={btnPrimary}>
              {saving ? <Spinner /> : <Save aria-hidden className="h-4 w-4" />} {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoStrip({ info, index }: { info: SettingsView["info"]; index: SettingsView["index"] }) {
  return (
    <ul className="flex flex-wrap gap-2 px-1 text-xs" aria-label="Current runtime">
      <li>
        <Chip>Store: {info.store}</Chip>
      </li>
      <li>
        <Chip>Cache: {info.cache}</Chip>
      </li>
      <li>
        <Chip>Vector size: {info.embed_dim}</Chip>
      </li>
      <li>
        <Chip title="Changes whenever a setting that affects answers changes">
          Answer fingerprint: <span className="font-mono">{info.answer_fingerprint.slice(0, 8)}</span>
        </Chip>
      </li>
      {index.chunks != null && (
        <li>
          <Chip>Indexed passages: {index.chunks}</Chip>
        </li>
      )}
    </ul>
  );
}

function TestOutcome({ result }: { result: TestResult | "running" | undefined }) {
  if (!result) return null;
  if (result === "running")
    return (
      <p className="mt-3 text-sm text-slate-500" role="status">
        Contacting the provider...
      </p>
    );
  const c = result.ok ? null : classifyProviderError(result.detail);
  return (
    <div
      role="status"
      className={`mt-3 animate-rise rounded-2xl border p-3.5 text-sm ${result.ok ? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-50" : "border-red-300 bg-red-50 text-red-950 dark:border-red-800 dark:bg-red-950/50 dark:text-red-50"}`}
    >
      <p className="flex flex-wrap items-center gap-2 font-semibold">
        {result.ok ? <CheckCircle2 aria-hidden className="h-4 w-4" /> : <XCircle aria-hidden className="h-4 w-4" />}
        {result.ok ? "Connection works" : c?.title}
        {result.latency_ms > 0 && <span className="text-xs font-normal opacity-75">{fmtMs(result.latency_ms)}</span>}
      </p>
      {!result.ok && c && <p className="mt-1 text-[13px]">{c.hint}</p>}
      <p className="mt-2 break-words rounded-lg bg-black/5 px-2.5 py-1.5 font-mono text-xs dark:bg-white/10">
        {result.ok && result.model ? `${result.model}: ` : ""}
        {result.detail}
      </p>
    </div>
  );
}

function FieldRow(p: {
  f: SettingField;
  value: string | boolean;
  secret?: string;
  reset: boolean;
  dirty: boolean;
  error: string | null;
  onChange: (v: string | boolean) => void;
  onSecret: (v: string) => void;
  onReset: () => void;
  onUndo: () => void;
}) {
  const { f } = p;
  const id = useId();
  const [replacing, setReplacing] = useState(false);
  const wide = f.kind === "textarea";
  const described = [f.help ? `${id}-help` : "", p.error ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined;
  const common = { id, "aria-invalid": Boolean(p.error) || undefined, "aria-describedby": described };
  const saved = f.source === "admin";

  let control: ReactNode;
  if (f.kind === "secret") {
    const hasSaved = Boolean(f.is_set);
    if (p.reset) {
      control = (
        <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
          This key will be removed when you save.
        </p>
      );
    } else if (hasSaved && !replacing && !p.secret) {
      control = (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex min-h-11 flex-1 items-center gap-2 rounded-xl border border-uoc-100 bg-white/50 px-3.5 text-sm dark:border-uoc-700 dark:bg-white/5 md:min-h-10">
            <Lock aria-hidden className="h-3.5 w-3.5 text-emerald-600" />{" "}
            <span className="font-mono">{f.masked || "••••"}</span> <span className="text-slate-500">saved</span>
          </span>
          <button
            type="button"
            onClick={() => setReplacing(true)}
            className={btnSecondary}
            aria-label={`Replace ${f.label}`}
          >
            <KeyRound aria-hidden className="h-4 w-4" /> Replace
          </button>
          <button type="button" onClick={p.onReset} className={btnSecondary} aria-label={`Clear saved ${f.label}`}>
            Clear
          </button>
        </div>
      );
    } else {
      control = (
        <div className="flex items-center gap-2">
          <input
            {...common}
            type="password"
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            data-1p-ignore
            value={p.secret ?? ""}
            onChange={(e) => p.onSecret(e.target.value)}
            placeholder={hasSaved ? "Paste the new key" : "Paste a key"}
            className={`${inputCls} font-mono`}
            autoFocus={replacing}
          />
          {hasSaved && (
            <button type="button" onClick={() => (setReplacing(false), p.onUndo())} className={btnGhost}>
              Cancel
            </button>
          )}
        </div>
      );
    }
  } else if (f.kind === "select") {
    control = (
      <select {...common} value={String(p.value)} onChange={(e) => p.onChange(e.target.value)} className={inputCls}>
        {f.options.map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    );
  } else if (f.kind === "number") {
    control = (
      <input
        {...common}
        type="number"
        inputMode={RATIO_KEYS.has(f.key) ? "decimal" : "numeric"}
        min={f.min ?? undefined}
        max={f.max ?? undefined}
        step={RATIO_KEYS.has(f.key) ? 0.05 : 1}
        value={String(p.value)}
        onChange={(e) => p.onChange(e.target.value)}
        className={inputCls}
      />
    );
  } else if (f.kind === "bool") {
    control = (
      <div className="flex min-h-11 items-center gap-3">
        <Switch checked={Boolean(p.value)} onChange={p.onChange} label={f.label} />
        <span className="text-sm text-slate-600 dark:text-slate-300">{p.value ? "On" : "Off"}</span>
      </div>
    );
  } else if (f.kind === "textarea") {
    control = (
      <textarea
        {...common}
        value={String(p.value)}
        onChange={(e) => p.onChange(e.target.value)}
        rows={5}
        className={`${inputCls} resize-y`}
        placeholder="Optional"
      />
    );
  } else {
    control = (
      <input
        {...common}
        type="text"
        value={String(p.value)}
        onChange={(e) => p.onChange(e.target.value)}
        placeholder={f.placeholder}
        autoCapitalize="none"
        spellCheck={false}
        className={inputCls}
      />
    );
  }

  return (
    <div className={wide || f.key === "llm_base_url" || f.key === "embed_base_url" ? "md:col-span-2" : ""}>
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <label htmlFor={id} className={labelCls}>
          {f.label}
        </label>
        {p.dirty ? (
          <Chip tone="warn">Unsaved</Chip>
        ) : saved ? (
          <Chip tone="brand" title="Overrides the server's environment default">
            Customised
          </Chip>
        ) : null}
        {f.kind === "textarea" && (
          <span className="ml-auto text-[11px] tabular-nums text-slate-500">{String(p.value).length}/1500</span>
        )}
        {(p.dirty || (saved && f.kind !== "secret")) && (
          <button
            type="button"
            onClick={p.dirty ? p.onUndo : p.onReset}
            aria-label={p.dirty ? `Undo changes to ${f.label}` : `Revert ${f.label} to the default`}
            className={`${f.kind === "textarea" ? "" : "ml-auto "}-my-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-medium text-uoc-600 hover:bg-uoc-100/70 md:-my-1 md:min-h-8 dark:text-uoc-300 dark:hover:bg-uoc-800/70`}
          >
            <RotateCcw aria-hidden className="h-3 w-3" /> {p.dirty ? "Undo" : "Revert to default"}
          </button>
        )}
      </div>
      {control}
      {f.help && (
        <p id={`${id}-help`} className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {f.help}
        </p>
      )}
      {p.error && (
        <p id={`${id}-err`} role="alert" className="mt-1 text-xs font-medium text-red-600 dark:text-red-300">
          {p.error}
        </p>
      )}
      {p.reset && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
          Will use the environment default after saving.
        </p>
      )}
    </div>
  );
}
