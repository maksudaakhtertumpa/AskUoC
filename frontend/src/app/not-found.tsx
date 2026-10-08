import { ArrowRight, Home, Info, MessageCircle, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/site/SiteHeader";

export const metadata: Metadata = { title: "Page not found" };

const suggestions = [
  { href: "/", label: "Home", note: "Start a new chat", Icon: Home },
  { href: "/about", label: "About", note: "What AskUoC is", Icon: Info },
  { href: "/privacy", label: "Privacy", note: "How your data is handled", Icon: ShieldCheck },
];

export default function NotFound() {
  return (
    <div className="app-bg flex min-h-dvh flex-col text-slate-900 dark:text-slate-100">
      <SiteHeader />
      <main
        id="main"
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4 py-12 text-center"
      >
        <p
          aria-hidden
          className="gradient-text select-none text-[7rem] font-bold leading-none tracking-tighter sm:text-[9rem]"
        >
          404
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-uoc-900 sm:text-3xl dark:text-white">
          We couldn&apos;t find that page
        </h1>
        <p className="mt-2 max-w-md text-slate-600 dark:text-slate-300">
          The link may be broken or the page may have moved. You can head back, or just ask the assistant what you were
          looking for.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full bg-gradient-to-r from-uoc-600 to-magenta-500 px-6 text-sm font-medium text-white shadow-md shadow-uoc-600/25 transition hover:brightness-110 active:scale-95"
        >
          <MessageCircle className="h-4 w-4" aria-hidden /> Ask the assistant
        </Link>
        <nav aria-label="Suggested pages" className="mt-10 grid w-full gap-3 text-left sm:grid-cols-3">
          {suggestions.map(({ href, label, note, Icon }) => (
            <Link
              key={href}
              href={href}
              className="glass group flex min-h-16 items-center gap-3 rounded-2xl p-3.5 transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-uoc-600/10 text-uoc-600 dark:bg-white/10 dark:text-uoc-200">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900 dark:text-white">{label}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{note}</span>
              </span>
              <ArrowRight
                className="h-4 w-4 text-uoc-400 transition group-hover:translate-x-0.5 group-hover:text-magenta-500"
                aria-hidden
              />
            </Link>
          ))}
        </nav>
      </main>
    </div>
  );
}
