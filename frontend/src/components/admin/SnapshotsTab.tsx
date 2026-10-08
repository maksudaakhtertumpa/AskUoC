"use client";

import {
  AlertTriangle,
  DatabaseBackup,
  Download,
  FileArchive,
  History,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import Modal from "@/components/ui/Modal";
import {
  MAX_SNAPSHOT_BYTES,
  createSnapshot,
  deleteSnapshot,
  downloadSnapshot,
  errMsg,
  fmtBytes,
  fmtInt,
  fullTime,
  getSnapshots,
  relTime,
  restoreSnapshot,
  uploadSnapshot,
  type Snapshot,
  type SnapshotsResponse,
} from "@/lib/admin";
import JobsPanel, { useJobs } from "./JobsPanel";
import {
  Card,
  Chip,
  EmptyState,
  Note,
  SectionTitle,
  Skeleton,
  Spinner,
  btnIcon,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  useResource,
  useToast,
  type Tone,
} from "./ui";

const KIND: Record<string, { label: string; tone: Tone }> = {
  manual: { label: "Manual", tone: "brand" },
  auto: { label: "Automatic", tone: "neutral" },
  uploaded: { label: "Uploaded", tone: "info" },
};

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: (s: Snapshot) => void }) {
  const [name, setName] = useState("");
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onDone(await createSnapshot(name.trim(), settings));
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };
  return (
    <Modal title="Create snapshot" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3.5">
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          A snapshot is a portable copy of everything the assistant knows: documents, passages and their search vectors.
        </p>
        <div>
          <label htmlFor="sn-name" className={labelCls}>
            Name <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="sn-name"
            className={`${inputCls} mt-1`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g. Before semester intake"
          />
        </div>
        <label className="flex min-h-11 items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={settings}
            onChange={(e) => setSettings(e.target.checked)}
            className="mt-1 h-4 w-4 accent-uoc-600"
          />
          <span>
            Include my saved settings{" "}
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              API keys are never included in a snapshot.
            </span>
          </span>
        </label>
        {error && <Note kind="error">{error}</Note>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button className={btnPrimary} disabled={busy}>
            {busy ? <Spinner /> : <DatabaseBackup aria-hidden className="h-4 w-4" />}{" "}
            {busy ? "Creating..." : "Create snapshot"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: (s: Snapshot) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pick = (f: File | null) => {
    setError("");
    if (f && f.size > MAX_SNAPSHOT_BYTES) return setError("That file is larger than the 200 MB limit.");
    setFile(f);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onDone(await uploadSnapshot(file, name.trim()));
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };
  return (
    <Modal title="Upload snapshot" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3.5">
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Upload a <code>.zip</code> you downloaded from an AskUoC snapshot. It is checked carefully and added to the
          list - nothing is restored until you choose to.
        </p>
        <div>
          <label htmlFor="su-file" className={labelCls}>
            Snapshot file
          </label>
          <input
            id="su-file"
            type="file"
            accept=".zip,application/zip"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full min-h-11 rounded-xl border border-dashed border-uoc-300 bg-white/50 p-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-uoc-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-uoc-800 dark:border-uoc-600 dark:bg-white/5 dark:file:bg-uoc-800 dark:file:text-uoc-100"
            required
          />
          {file && (
            <p className="mt-1 text-xs text-slate-500">
              {file.name} - {fmtBytes(file.size)}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="su-name" className={labelCls}>
            Name <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="su-name"
            className={`${inputCls} mt-1`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
        </div>
        {error && <Note kind="error">{error}</Note>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button className={btnPrimary} disabled={!file || busy}>
            {busy ? <Spinner /> : <Upload aria-hidden className="h-4 w-4" />} {busy ? "Uploading..." : "Upload"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RestoreModal({
  snap,
  currentEmbed,
  onClose,
  onStarted,
}: {
  snap: Snapshot;
  currentEmbed: string;
  onClose: () => void;
  onStarted: (job: Awaited<ReturnType<typeof restoreSnapshot>>) => void;
}) {
  const differs = snap.embed_fingerprint !== currentEmbed;
  const [mode, setMode] = useState<"exact" | "re_embed">(differs ? "re_embed" : "exact");
  const [withSettings, setWithSettings] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ok = confirm === "RESTORE";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      onStarted(await restoreSnapshot(snap.id, mode, withSettings));
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };
  const radio =
    "flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border p-3 text-sm transition has-[:checked]:border-uoc-500 has-[:checked]:bg-uoc-50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 dark:border-uoc-700 dark:has-[:checked]:bg-uoc-800/60 border-uoc-100";
  return (
    <Modal title="Restore snapshot" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Note kind="warn" title="This replaces the current knowledge base">
          Everything the assistant knows now will be swapped for <b>{snap.name}</b> ({fmtInt(snap.documents)} documents,{" "}
          {fmtInt(snap.chunks)} passages, from {fullTime(snap.created_at)}). A safety snapshot of the current data is
          saved automatically first.
        </Note>
        <fieldset className="space-y-2">
          <legend className={`${labelCls} mb-1`}>How to restore</legend>
          <label className={radio}>
            <input
              type="radio"
              name="mode"
              value="exact"
              checked={mode === "exact"}
              disabled={differs}
              onChange={() => setMode("exact")}
              className="mt-1 accent-uoc-600"
            />
            <span>
              <b>Exact copy</b> - fast, uses the stored vectors.
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {differs
                  ? "Unavailable: this snapshot used a different embedding model."
                  : "The embedding model matches."}
              </span>
            </span>
          </label>
          <label className={radio}>
            <input
              type="radio"
              name="mode"
              value="re_embed"
              checked={mode === "re_embed"}
              onChange={() => setMode("re_embed")}
              className="mt-1 accent-uoc-600"
            />
            <span>
              <b>Re-embed</b> - slower, embeds the text with the current model.
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                Uses your embedding provider&apos;s quota. {differs ? "Required for this snapshot." : ""}
              </span>
            </span>
          </label>
        </fieldset>
        {differs && (
          <p className="break-words text-xs text-slate-500 dark:text-slate-400">
            Snapshot model: <code>{snap.embed_fingerprint}</code> - current: <code>{currentEmbed}</code>
          </p>
        )}
        {snap.has_settings && (
          <label className="flex min-h-11 items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={withSettings}
              onChange={(e) => setWithSettings(e.target.checked)}
              className="mt-1 h-4 w-4 accent-uoc-600"
            />
            <span>
              Also restore the settings saved in this snapshot{" "}
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                API keys are not part of snapshots and stay as they are.
              </span>
            </span>
          </label>
        )}
        <div>
          <label htmlFor="rs-confirm" className={labelCls}>
            Type <b className="font-mono">RESTORE</b> to confirm
          </label>
          <input
            id="rs-confirm"
            className={`${inputCls} mt-1 font-mono`}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </div>
        {error && <Note kind="error">{error}</Note>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-red-600 px-4 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 md:min-h-9"
            disabled={!ok || busy}
          >
            {busy ? <Spinner /> : <RotateCcw aria-hidden className="h-4 w-4" />} Restore now
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function SnapshotsTab() {
  const toast = useToast();
  const res = useResource<SnapshotsResponse>(getSnapshots);
  const jobs = useJobs(() => void res.reload());
  const [modal, setModal] = useState<"create" | "upload" | null>(null);
  const [restoring, setRestoring] = useState<Snapshot | null>(null);
  const [delSnap, setDelSnap] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const jobsRef = useRef<HTMLDivElement>(null);
  const list = res.data?.snapshots;
  const current = res.data?.current_embed ?? "";

  const download = async (s: Snapshot) => {
    setBusy(s.id);
    try {
      await downloadSnapshot(s.id);
      toast.success(`Downloading ${s.name}.`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    const s = delSnap;
    if (!s) return;
    setDelSnap(null);
    setBusy(s.id);
    try {
      await deleteSnapshot(s.id);
      toast.success(`Deleted ${s.name}.`);
      await res.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div ref={jobsRef}>
        <JobsPanel
          state={jobs}
          kinds={["restore"]}
          title="Restore progress"
          hint={
            jobs.active
              ? "Restoring - please keep this page open. It updates automatically."
              : "When you restore a snapshot, progress and the result appear here."
          }
        />
      </div>

      <Card aria-labelledby="snap-title">
        <SectionTitle
          id="snap-title"
          icon={<History aria-hidden className="h-4 w-4" />}
          title="Snapshots"
          hint="Backups of the knowledge base. Automatic ones are taken before deleting a document or restoring (the latest 5 are kept)."
          actions={
            <>
              <button onClick={() => setModal("upload")} className={btnSecondary}>
                <Upload aria-hidden className="h-4 w-4" /> Upload
              </button>
              <button onClick={() => setModal("create")} className={btnPrimary}>
                <Plus aria-hidden className="h-4 w-4" /> Create snapshot
              </button>
            </>
          }
        />
        {res.loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : res.error && !list ? (
          <Note
            kind="error"
            title="Couldn't load snapshots"
            action={
              <button className={btnSecondary} onClick={() => void res.reload()}>
                Try again
              </button>
            }
          >
            {res.error.message}
          </Note>
        ) : !list?.length ? (
          <EmptyState icon={<FileArchive className="h-6 w-6" />} title="No snapshots yet">
            Create one now so you can always roll back.
          </EmptyState>
        ) : (
          <ul className="space-y-3" aria-label="Snapshots">
            {list.map((s) => {
              const k = KIND[s.kind] ?? { label: s.kind, tone: "neutral" as Tone };
              const differs = s.embed_fingerprint !== current;
              return (
                <li
                  key={s.id}
                  className={`rounded-2xl bg-white/50 p-4 transition dark:bg-white/5 ${busy === s.id ? "opacity-60" : ""}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="break-words font-semibold">{s.name}</span>
                        <Chip tone={k.tone}>{k.label}</Chip>
                        {s.has_settings && (
                          <Chip tone="info" title="Contains non-secret settings">
                            Settings
                          </Chip>
                        )}
                        {differs && (
                          <Chip tone="warn" title={`Built with ${s.embed_fingerprint}; current is ${current}`}>
                            <AlertTriangle aria-hidden className="h-3 w-3" /> Older embedding model
                          </Chip>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        <span title={fullTime(s.created_at)}>{relTime(s.created_at)}</span> - by {s.actor} -{" "}
                        {fmtBytes(s.size)} - {fmtInt(s.documents)} documents, {fmtInt(s.chunks)} passages
                      </p>
                      {s.note && <p className="mt-1 text-xs italic text-slate-500 dark:text-slate-400">{s.note}</p>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => void download(s)}
                        disabled={busy === s.id}
                        aria-label={`Download ${s.name}`}
                        title="Download"
                        className={btnIcon}
                      >
                        {busy === s.id ? <Spinner /> : <Download className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() => setRestoring(s)}
                        disabled={busy === s.id || jobs.active}
                        className={btnSecondary}
                      >
                        <RotateCcw aria-hidden className="h-4 w-4" /> Restore
                      </button>
                      <button
                        onClick={() => setDelSnap(s)}
                        disabled={busy === s.id}
                        aria-label={`Delete ${s.name}`}
                        title="Delete"
                        className={`${btnIcon} hover:!bg-red-50 hover:!text-red-600 dark:hover:!bg-red-950/50`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          <ShieldCheck aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Snapshots never contain API keys or user
          accounts.
        </p>
      </Card>

      {modal === "create" && (
        <CreateModal
          onClose={() => setModal(null)}
          onDone={(s) => {
            setModal(null);
            toast.success(`Snapshot "${s.name}" created (${fmtBytes(s.size)}).`);
            void res.reload();
          }}
        />
      )}
      {modal === "upload" && (
        <UploadModal
          onClose={() => setModal(null)}
          onDone={(s) => {
            setModal(null);
            toast.success(`Uploaded "${s.name}". Restore it whenever you're ready.`);
            void res.reload();
          }}
        />
      )}
      {restoring && (
        <RestoreModal
          snap={restoring}
          currentEmbed={current}
          onClose={() => setRestoring(null)}
          onStarted={(job) => {
            setRestoring(null);
            jobs.track(job);
            toast.info("Restore started. Progress is shown at the top of this page.");
            jobsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      )}
      {delSnap && (
        <ConfirmDialog
          title="Delete this snapshot?"
          body={`"${delSnap.name}" will be permanently removed. If it's your only backup, you won't be able to roll back to it.`}
          confirmLabel="Delete snapshot"
          onConfirm={() => void remove()}
          onCancel={() => setDelSnap(null)}
        />
      )}
    </div>
  );
}
