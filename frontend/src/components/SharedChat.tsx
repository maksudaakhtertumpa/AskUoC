"use client";

import { GraduationCap, MessageCircleQuestion } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchShare, type ShareSnapshot } from "@/lib/api";
import Footer from "./Footer";
import MessageBody from "./MessageBody";
import Sources from "./Sources";

type Loaded = (ShareSnapshot & { created_at: string }) | null | "loading";

/** Public, read-only view of a shared conversation snapshot. */
export default function SharedChat() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Loaded>("loading");

  useEffect(() => {
    let alive = true;
    void fetchShare(id).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <div className="app-bg min-h-dvh text-slate-900 dark:text-slate-100">
      <header className="glass sticky top-0 z-10 rounded-none border-x-0 border-t-0 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold text-uoc-800 dark:text-uoc-100">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-uoc-600 to-magenta-500 text-white shadow-md shadow-uoc-600/25">
              <GraduationCap className="h-4 w-4" />
            </span>
            AskUoC
          </Link>
          <Link
            href="/"
            className="rounded-full bg-gradient-to-r from-uoc-600 to-magenta-500 px-4 py-2 text-sm font-medium text-white shadow-md shadow-uoc-600/25 transition hover:brightness-110 active:scale-95"
          >
            Ask your own question
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {data === "loading" && <p className="py-20 text-center text-sm text-slate-400">Loading conversation…</p>}
        {data === null && (
          <div className="py-20 text-center">
            <MessageCircleQuestion className="mx-auto h-10 w-10 text-uoc-300" />
            <h1 className="mt-4 text-lg font-semibold">This conversation isn&apos;t available</h1>
            <p className="mt-1 text-sm text-slate-500">The link may have been deleted by its owner or has expired.</p>
          </div>
        )}
        {data && data !== "loading" && (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">{data.title}</h1>
            <p className="mt-1 text-xs text-slate-500">
              Shared conversation ·{" "}
              {new Date(data.created_at).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}{" "}
              · read-only snapshot
            </p>
            <ul className="mt-8 space-y-6">
              {data.messages.map((m, i) =>
                m.role === "user" ? (
                  <li key={i} className="flex justify-end">
                    <div className="max-w-[88%] rounded-3xl rounded-br-lg bg-gradient-to-br from-uoc-600 to-magenta-500 px-4 py-2.5 text-[15px] text-white shadow-lg shadow-uoc-600/20 sm:max-w-[80%]">
                      {m.quote && (
                        <blockquote className="mb-2 rounded-xl bg-white/15 px-2.5 py-1.5 text-xs">{m.quote}</blockquote>
                      )}
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                    </div>
                  </li>
                ) : (
                  <li key={i} className="flex gap-2.5 sm:gap-3">
                    <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-uoc-600 to-magenta-500 text-white shadow-md shadow-uoc-600/25">
                      <GraduationCap className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="glass rounded-3xl rounded-tl-lg px-4 py-3 sm:px-5 sm:py-3.5">
                        <MessageBody text={m.content} sources={m.sources.map((s) => ({ ...s, snippet: "" }))} />
                      </div>
                      <Sources text={m.content} sources={m.sources.map((s) => ({ ...s, snippet: "" }))} />
                    </div>
                  </li>
                ),
              )}
            </ul>
          </>
        )}
      </main>
      <div className="px-4 pb-6">
        <Footer dataDate={null} />
      </div>
    </div>
  );
}
