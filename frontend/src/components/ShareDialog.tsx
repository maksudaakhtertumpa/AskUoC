"use client";

import { Check, Copy, Download, ExternalLink, FileText, Globe, Link2, Loader2, Share2, Trash2, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createShare, deleteShare } from "@/lib/api";
import type { Conversation } from "@/lib/history";
import { downloadText, loadShares, saveShare, toMarkdown, toSnapshot, type ShareRecord } from "@/lib/share";

const noop = () => () => undefined;

export default function ShareDialog({ conv, onClose }: { conv: Conversation; onClose: () => void }) {
  const [record, setRecord] = useState<ShareRecord | null>(() => loadShares()[conv.id] ?? null);
  const [busy, setBusy] = useState<"create" | "delete" | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"link" | "text" | null>(null);
  const canNativeShare = useSyncExternalStore(
    noop,
    () => typeof navigator !== "undefined" && "share" in navigator,
    () => false,
  );
  const link = record ? `${window.location.origin}/s/${record.id}` : "";

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  const flash = (what: "link" | "text") => {
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
  };

  const create = async () => {
    setBusy("create");
    setError("");
    try {
      const { id, delete_token } = await createShare(toSnapshot(conv));
      const rec = { id, token: delete_token, createdAt: Date.now() };
      saveShare(conv.id, rec);
      setRecord(rec);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!record) return;
    setBusy("delete");
    const ok = await deleteShare(record.id, record.token);
    setBusy(null);
    if (!ok) return setError("Couldn't delete the link right now. Please try again.");
    saveShare(conv.id, null);
    setRecord(null);
  };

  const copy = async (text: string, what: "link" | "text") => {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    flash(what);
  };

  const secondary =
    "flex items-center justify-center gap-2 rounded-xl border border-uoc-100 px-3 py-2.5 text-sm transition hover:bg-uoc-50 active:scale-[0.98] dark:border-uoc-800 dark:hover:bg-uoc-800";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Share conversation"
    >
      <div
        className="absolute inset-0 animate-[fade_0.15s_ease-out] bg-uoc-950/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div className="glass-strong relative w-full max-w-md animate-pop rounded-3xl p-6">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-uoc-50 dark:hover:bg-uoc-800"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-uoc-600 to-magenta-500 text-white shadow-md shadow-uoc-600/25">
            <Share2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-tight">Share conversation</h2>
            <p className="truncate text-xs text-slate-500">{conv.title}</p>
          </div>
        </div>

        {record ? (
          <div className="mt-5 space-y-3">
            <div className="flex items-center gap-2 rounded-2xl border border-uoc-100 bg-uoc-50/60 p-1.5 pl-3 dark:border-uoc-800 dark:bg-uoc-950/40">
              <Link2 className="h-4 w-4 shrink-0 text-uoc-500" />
              <input
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Shared link"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
              <button
                onClick={() => copy(link, "link")}
                className="flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-uoc-600 to-magenta-500 px-3 py-2 text-sm font-medium text-white transition hover:brightness-110 active:scale-95"
              >
                {copied === "link" ? <Check className="h-4 w-4 animate-pop" /> : <Copy className="h-4 w-4" />}{" "}
                {copied === "link" ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Anyone with this link can read this conversation as it is now. Later messages aren&apos;t included. The
              link expires after 90 days.
            </p>
            <div className="flex items-center justify-between">
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-sm text-uoc-600 hover:underline dark:text-uoc-300"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open link
              </a>
              <button
                onClick={remove}
                disabled={busy !== null}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/40"
              >
                {busy === "delete" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}{" "}
                Delete link
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Creates a public link to a snapshot of this chat. Only the text and source links are shared - attachments
              never are. Anyone with the link can view it, and you can delete the link at any time.
            </p>
            <button
              onClick={create}
              disabled={busy !== null}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-uoc-600 to-magenta-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-uoc-600/25 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
            >
              {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}{" "}
              {busy === "create" ? "Creating link…" : "Create link"}
            </button>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <div className="mt-5 border-t border-uoc-100 pt-4 dark:border-uoc-800">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-uoc-400">Or keep a copy</p>
          <div className={`grid gap-2 ${canNativeShare ? "grid-cols-3" : "grid-cols-2"}`}>
            <button onClick={() => copy(toMarkdown(conv), "text")} className={secondary}>
              {copied === "text" ? (
                <Check className="h-4 w-4 animate-pop text-emerald-500" />
              ) : (
                <FileText className="h-4 w-4" />
              )}{" "}
              {copied === "text" ? "Copied" : "Copy text"}
            </button>
            <button onClick={() => downloadText(conv.title, toMarkdown(conv))} className={secondary}>
              <Download className="h-4 w-4" /> Download
            </button>
            {canNativeShare && (
              <button
                onClick={() =>
                  navigator
                    .share({ title: conv.title, text: toMarkdown(conv), ...(link ? { url: link } : {}) })
                    .catch(() => undefined)
                }
                className={secondary}
              >
                <Share2 className="h-4 w-4" /> Share…
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
