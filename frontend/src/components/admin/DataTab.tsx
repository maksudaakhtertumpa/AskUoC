"use client";

import {
  ExternalLink,
  FilePlus2,
  FileText,
  FileUp,
  Library,
  RefreshCcw,
  Search,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  DOC_TYPES,
  MAX_UPLOAD_BYTES,
  UPLOAD_EXT,
  UOC_URL,
  addText,
  deleteDocument,
  errMsg,
  fmtBytes,
  fmtInt,
  getDocuments,
  getSettings,
  humanize,
  reindex,
  relTime,
  uploadFile,
  fullTime,
  type Doc,
  type DocsResponse,
} from "@/lib/admin";
import JobsPanel, { useJobs } from "./JobsPanel";
import type { TabId } from "./tabs";
import {
  Card,
  Chip,
  EmptyState,
  Note,
  SectionTitle,
  Skeleton,
  Spinner,
  TableWrap,
  btnIcon,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  td,
  th,
  useResource,
  useToast,
  type Resource,
  type Tone,
} from "./ui";

export type TextDraft = { title: string; markdown: string; key: number };
const TYPE_TONE: Record<string, Tone> = {
  faq: "brand",
  upload: "info",
  pdf: "warn",
  funding: "good",
  programme: "neutral",
};
const PAGE = 40;

export default function DataTab({
  isAdmin,
  draft,
  onConsumeDraft,
  go,
}: {
  isAdmin: boolean;
  draft: TextDraft | null;
  onConsumeDraft: () => void;
  go: (t: TabId) => void;
}) {
  const toast = useToast();
  const [initialDraft] = useState(draft); // captured once: the parent clears it right after
  useEffect(() => {
    if (draft) onConsumeDraft();
  }, [draft, onConsumeDraft]);
  const docs = useResource(getDocuments);
  const settings = useResource(getSettings, { enabled: isAdmin });
  const jobs = useJobs(() => {
    void docs.reload();
    if (isAdmin) void settings.reload();
  });
  const [confirmReindex, setConfirmReindex] = useState(false);
  const [busyReindex, setBusyReindex] = useState(false);
  const idx = settings.data?.index;

  const runReindex = async () => {
    setConfirmReindex(false);
    setBusyReindex(true);
    try {
      jobs.track(await reindex());
      toast.info("Re-embedding started. Progress is shown below.");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyReindex(false);
    }
  };

  return (
    <div className="space-y-4">
      {isAdmin && idx?.stale && (
        <Note
          kind="warn"
          role="alert"
          title="The embedding model changed - re-embed your data"
          action={
            <button
              onClick={() => setConfirmReindex(true)}
              disabled={busyReindex || jobs.active}
              className={btnPrimary}
            >
              Re-embed all
            </button>
          }
        >
          The stored passages were embedded with{" "}
          <code className="rounded bg-black/5 px-1 dark:bg-white/10">{idx.built_with}</code> but the assistant now
          searches with <code className="rounded bg-black/5 px-1 dark:bg-white/10">{idx.current}</code>. Until you
          re-embed, search results will be poor.
        </Note>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <UploadCard jobs={jobs} />
        <TextCard draft={initialDraft} jobs={jobs} />
      </div>

      <JobsPanel state={jobs} title="Jobs" />

      <DocumentsCard
        docs={docs}
        isAdmin={isAdmin}
        goSettings={() => go("settings")}
        reembed={
          isAdmin ? (
            <button
              onClick={() => setConfirmReindex(true)}
              disabled={busyReindex || jobs.active}
              className={btnSecondary}
            >
              {busyReindex ? <Spinner /> : <RefreshCcw aria-hidden className="h-4 w-4" />} Re-embed all
            </button>
          ) : null
        }
      />

      {confirmReindex && (
        <ConfirmDialog
          title="Re-embed all passages?"
          body={`Every stored passage will be embedded again with the current model${idx ? ` (${idx.current})` : ""}. It can take several minutes and uses your embedding provider's quota. Search keeps working meanwhile, but is best after it finishes.`}
          confirmLabel="Re-embed all"
          danger={false}
          onConfirm={() => void runReindex()}
          onCancel={() => setConfirmReindex(false)}
        />
      )}
    </div>
  );
}

function TypeSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {DOC_TYPES.map((t) => (
        <option key={t} value={t}>
          {humanize(t)}
        </option>
      ))}
    </select>
  );
}

const validUrl = (u: string) => !u.trim() || u.trim().startsWith(UOC_URL);

function UploadCard({ jobs }: { jobs: ReturnType<typeof useJobs> }) {
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [docType, setDocType] = useState("upload");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const add = (list: FileList | File[]) => {
    const ok: File[] = [];
    for (const f of Array.from(list)) {
      const ext = "." + (f.name.split(".").pop() ?? "").toLowerCase();
      if (!(UPLOAD_EXT as readonly string[]).includes(ext))
        toast.error(`${f.name}: unsupported type. Use PDF, Markdown, text, HTML or crawler JSON.`);
      else if (f.size > MAX_UPLOAD_BYTES)
        toast.error(`${f.name} is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).`);
      else if (f.size === 0) toast.error(`${f.name} is empty.`);
      else ok.push(f);
    }
    setFiles((cur) => [...cur, ...ok.filter((f) => !cur.some((c) => c.name === f.name && c.size === f.size))]);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    add(e.dataTransfer.files);
  };

  const urlBad = !validUrl(url);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!files.length || urlBad) return;
    setBusy(true);
    const failed: File[] = [];
    let queued = 0;
    for (const f of files) {
      try {
        jobs.track(
          await uploadFile(f, { doc_type: docType, title: files.length === 1 ? title.trim() : "", url: url.trim() }),
        );
        queued++;
      } catch (err) {
        failed.push(f);
        toast.error(`${f.name}: ${errMsg(err)}`);
      }
    }
    setBusy(false);
    setFiles(failed);
    if (queued) {
      toast.success(`${queued} file${queued > 1 ? "s" : ""} queued. Watch progress under Jobs.`);
      if (!failed.length) {
        setTitle("");
        setUrl("");
      }
    }
  };

  return (
    <Card aria-labelledby="up-title">
      <SectionTitle
        id="up-title"
        icon={<FileUp aria-hidden className="h-4 w-4" />}
        title="Upload files"
        hint="PDF, Markdown, text, HTML, or crawler JSON - up to 40 MB each."
      />
      <form onSubmit={submit} className="space-y-3">
        <div
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={`relative flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-7 text-center transition ${over ? "border-magenta-400 bg-magenta-50/70 dark:bg-magenta-900/20" : "border-uoc-200 bg-white/40 hover:border-uoc-400 dark:border-uoc-700 dark:bg-white/5"}`}
        >
          <UploadCloud aria-hidden className="h-8 w-8 text-uoc-500" />
          <p className="text-sm font-medium">Drag files here, or</p>
          <button type="button" onClick={() => input.current?.click()} className={btnSecondary}>
            Choose files
          </button>
          <input
            ref={input}
            type="file"
            multiple
            accept={UPLOAD_EXT.join(",")}
            className="sr-only"
            aria-label="Choose files to upload"
            tabIndex={-1}
            onChange={(e) => {
              if (e.target.files) add(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {files.length > 0 && (
          <ul className="space-y-1.5" aria-label="Files ready to upload">
            {files.map((f) => (
              <li
                key={f.name + f.size}
                className="flex items-center gap-2 rounded-xl bg-white/50 py-1 pl-3 pr-1 text-sm dark:bg-white/5"
              >
                <FileText aria-hidden className="h-4 w-4 shrink-0 text-uoc-500" />
                <span className="min-w-0 flex-1 truncate" title={f.name}>
                  {f.name}
                </span>
                <span className="shrink-0 text-xs text-slate-500">{fmtBytes(f.size)}</span>
                <button
                  type="button"
                  onClick={() => setFiles((c) => c.filter((x) => x !== f))}
                  aria-label={`Remove ${f.name}`}
                  className={btnIcon}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="up-type" className={labelCls}>
              Type
            </label>
            <div className="mt-1">
              <TypeSelect id="up-type" value={docType} onChange={setDocType} />
            </div>
          </div>
          <div>
            <label htmlFor="up-title-in" className={labelCls}>
              Title <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="up-title-in"
              className={`${inputCls} mt-1`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={files.length > 1}
              placeholder={files.length > 1 ? "Uses each file name" : "Uses the file name"}
              maxLength={200}
            />
          </div>
        </div>
        <div>
          <label htmlFor="up-url" className={labelCls}>
            Source link <span className="font-normal text-slate-400">(optional, shown in citations)</span>
          </label>
          <input
            id="up-url"
            className={`${inputCls} mt-1`}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={`${UOC_URL}...`}
            inputMode="url"
            aria-invalid={urlBad}
            aria-describedby={urlBad ? "up-url-err" : undefined}
          />
          {urlBad && (
            <p id="up-url-err" className="mt-1 text-xs text-red-600 dark:text-red-300">
              The link must be a cyberjaya.edu.my page.
            </p>
          )}
        </div>
        <button className={`${btnPrimary} w-full`} disabled={!files.length || busy || urlBad}>
          {busy ? <Spinner /> : <FileUp aria-hidden className="h-4 w-4" />}
          {busy
            ? "Uploading..."
            : files.length
              ? `Upload ${files.length} file${files.length > 1 ? "s" : ""}`
              : "Upload"}
        </button>
      </form>
    </Card>
  );
}

function TextCard({ draft, jobs }: { draft: TextDraft | null; jobs: ReturnType<typeof useJobs> }) {
  const toast = useToast();
  const [title, setTitle] = useState(draft?.title ?? "");
  const [markdown, setMarkdown] = useState(draft?.markdown ?? "");
  const [docType, setDocType] = useState("faq");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!draft) return;
    box.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    area.current?.focus({ preventScroll: true });
    area.current?.setSelectionRange(area.current.value.length, area.current.value.length);
  }, [draft]);

  const urlBad = !validUrl(url);
  const short = markdown.trim().length < 20;
  const ready = title.trim().length >= 2 && !short && !urlBad;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      jobs.track(await addText({ title: title.trim(), markdown, doc_type: docType, url: url.trim() || null }));
      toast.success("Entry queued. It becomes searchable in a few seconds.");
      setTitle("");
      setMarkdown("");
      setUrl("");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card aria-labelledby="tx-title" ref={box}>
      <SectionTitle
        id="tx-title"
        icon={<FilePlus2 aria-hidden className="h-4 w-4" />}
        title="Add an answer or note"
        hint="Write an FAQ or paste text. Markdown is fine."
      />
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
          <div>
            <label htmlFor="tx-name" className={labelCls}>
              Title
            </label>
            <input
              id="tx-name"
              className={`${inputCls} mt-1`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="e.g. Can I pay fees in instalments?"
              required
            />
          </div>
          <div>
            <label htmlFor="tx-type" className={labelCls}>
              Type
            </label>
            <div className="mt-1">
              <TypeSelect id="tx-type" value={docType} onChange={setDocType} />
            </div>
          </div>
        </div>
        <div>
          <label htmlFor="tx-body" className={labelCls}>
            Content
          </label>
          <textarea
            ref={area}
            id="tx-body"
            className={`${inputCls} mt-1 min-h-40 resize-y font-[inherit]`}
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            maxLength={200_000}
            placeholder="Write the answer the way the university would say it."
            aria-describedby="tx-help"
            required
          />
          <p
            id="tx-help"
            className={`mt-1 text-xs ${short && markdown ? "text-amber-600 dark:text-amber-300" : "text-slate-500 dark:text-slate-400"}`}
          >
            {short
              ? `At least 20 characters (${markdown.trim().length} so far).`
              : `${fmtInt(markdown.length)} characters.`}
          </p>
        </div>
        <div>
          <label htmlFor="tx-url" className={labelCls}>
            Source link <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="tx-url"
            className={`${inputCls} mt-1`}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={`${UOC_URL}...`}
            inputMode="url"
            aria-invalid={urlBad}
          />
          {urlBad && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-300">The link must be a cyberjaya.edu.my page.</p>
          )}
        </div>
        <button className={`${btnPrimary} w-full`} disabled={!ready || busy}>
          {busy ? <Spinner /> : <FilePlus2 aria-hidden className="h-4 w-4" />}{" "}
          {busy ? "Saving..." : "Add to knowledge base"}
        </button>
      </form>
    </Card>
  );
}

function DocumentsCard({
  docs,
  isAdmin,
  reembed,
  goSettings,
}: {
  docs: Resource<DocsResponse>;
  isAdmin: boolean;
  reembed: React.ReactNode;
  goSettings: () => void;
}) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [del, setDel] = useState<Doc | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const all = docs.data?.documents;
  const types = useMemo(() => [...new Set((all ?? []).map((d) => d.doc_type))].sort(), [all]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (all ?? []).filter(
      (d) =>
        (!type || d.doc_type === type) &&
        (!needle || d.title.toLowerCase().includes(needle) || d.url.toLowerCase().includes(needle)),
    );
  }, [all, q, type]);
  const shown = filtered.slice(0, limit);
  const hasDates = (all ?? []).some((d) => d.updated_at); // only the Postgres store records this

  const remove = async () => {
    const d = del;
    if (!d) return;
    setDel(null);
    setDeleting(d.url);
    try {
      const r = await deleteDocument(d.url);
      toast.success(`Removed "${d.title}" (${r.removed_chunks} passages). A safety snapshot was saved first.`);
      await docs.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
      <Card aria-labelledby="docs-title">
        <SectionTitle
          id="docs-title"
          icon={<Library aria-hidden className="h-4 w-4" />}
          title="Knowledge base"
          hint={
            docs.data
              ? `${fmtInt(docs.data.documents.length)} documents - ${fmtInt(docs.data.total_chunks)} searchable passages`
              : "Everything the assistant can cite"
          }
          actions={reembed}
        />
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            />
            <input
              type="search"
              aria-label="Search documents"
              value={q}
              onChange={(e) => (setQ(e.target.value), setLimit(PAGE))}
              placeholder="Search by title or link"
              className={`${inputCls} pl-10`}
            />
          </div>
          <select
            aria-label="Filter by type"
            value={type}
            onChange={(e) => (setType(e.target.value), setLimit(PAGE))}
            className={`${inputCls} sm:w-48`}
          >
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </select>
        </div>

        {docs.loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : docs.error && !all ? (
          <Note
            kind="error"
            title="Couldn't load documents"
            action={
              <button className={btnSecondary} onClick={() => void docs.reload()}>
                Try again
              </button>
            }
          >
            {docs.error.message}
          </Note>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Library className="h-6 w-6" />}
            title={all?.length ? "No documents match" : "The knowledge base is empty"}
          >
            {all?.length
              ? "Try a different search or type filter."
              : "Upload a file or add a note above to teach the assistant."}
          </EmptyState>
        ) : (
          <>
            <TableWrap label="Documents">
              <table className="w-full min-w-[32rem] border-collapse text-left">
                <caption className="sr-only">Documents in the knowledge base</caption>
                <thead className="border-b border-uoc-100 dark:border-white/10">
                  <tr>
                    <th scope="col" className={`${th} w-1/2`}>
                      Title
                    </th>
                    <th scope="col" className={`${th} hidden sm:table-cell`}>
                      Type
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      Passages
                    </th>
                    {hasDates && (
                      <th scope="col" className={`${th} hidden lg:table-cell`}>
                        Updated
                      </th>
                    )}
                    {isAdmin && (
                      <th scope="col" className={`${th} w-14`}>
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-uoc-100/70 dark:divide-white/10">
                  {shown.map((d) => {
                    const web = /^https?:\/\//.test(d.url);
                    return (
                      <tr
                        key={d.url}
                        className={`transition hover:bg-white/40 dark:hover:bg-white/5 ${deleting === d.url ? "opacity-50" : ""}`}
                      >
                        <th scope="row" className={`${td} max-w-0 font-normal`}>
                          <p className="truncate font-medium" title={d.title}>
                            {d.title}
                          </p>
                          <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                            <Chip tone={TYPE_TONE[d.doc_type] ?? "neutral"} className="sm:hidden">
                              {humanize(d.doc_type)}
                            </Chip>
                            {web ? (
                              <a
                                href={d.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex min-w-0 items-center gap-1 hover:underline"
                              >
                                <span className="truncate">{d.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                                <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
                                <span className="sr-only">(opens in a new tab)</span>
                              </a>
                            ) : (
                              <span className="truncate">Uploaded content</span>
                            )}
                          </p>
                        </th>
                        <td className={`${td} hidden sm:table-cell`}>
                          <Chip tone={TYPE_TONE[d.doc_type] ?? "neutral"}>{humanize(d.doc_type)}</Chip>
                        </td>
                        <td className={`${td} text-right tabular-nums`}>{fmtInt(d.chunks)}</td>
                        {hasDates && (
                          <td
                            className={`${td} hidden whitespace-nowrap text-xs text-slate-500 lg:table-cell dark:text-slate-400`}
                            title={fullTime(d.updated_at)}
                          >
                            {d.updated_at ? relTime(d.updated_at) : "-"}
                          </td>
                        )}
                        {isAdmin && (
                          <td className={td}>
                            <button
                              onClick={() => setDel(d)}
                              disabled={deleting !== null}
                              aria-label={`Delete ${d.title}`}
                              className={`${btnIcon} hover:!bg-red-50 hover:!text-red-600 dark:hover:!bg-red-950/50`}
                            >
                              {deleting === d.url ? <Spinner /> : <Trash2 className="h-4 w-4" />}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>
                Showing {shown.length} of {filtered.length}
              </span>
              {filtered.length > shown.length && (
                <button className={btnSecondary} onClick={() => setLimit((l) => l + PAGE)}>
                  Show {Math.min(PAGE, filtered.length - shown.length)} more
                </button>
              )}
            </div>
          </>
        )}
        {!isAdmin && !docs.loading && (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Removing documents and re-embedding are admin actions.
          </p>
        )}
        {isAdmin && (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Deleting a document is recoverable: a snapshot is taken first.{" "}
            <button
              onClick={goSettings}
              className="font-medium text-uoc-600 underline underline-offset-2 dark:text-uoc-300"
            >
              Change the embedding model
            </button>
          </p>
        )}
      </Card>
      {/* outside the glass Card: backdrop-filter would otherwise trap this fixed overlay inside the card */}
      {del && (
        <ConfirmDialog
          title="Delete this document?"
          body={`"${del.title}" and its ${del.chunks} passage${del.chunks === 1 ? "" : "s"} will stop being searchable. An automatic snapshot is saved first, so you can restore it from Snapshots.`}
          confirmLabel="Delete document"
          onConfirm={() => void remove()}
          onCancel={() => setDel(null)}
        />
      )}
    </>
  );
}
