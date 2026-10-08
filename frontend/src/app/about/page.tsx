import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { type LegalSection } from "@/components/site/LegalPage";
import { AUTHOR_NAME, AUTHOR_URL, OPERATOR_NAME, REPO_URL, UOC_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "What AskUoC is, how its retrieval-augmented pipeline answers questions from the University of Cyberjaya website, the tech stack, data freshness, credits and open-source licences.",
  alternates: { canonical: "/about" },
};

const steps: { name: string; note: string }[] = [
  { name: "You ask", note: "in the web app" },
  { name: "Route & rewrite", note: "greeting or question; follow-ups become standalone" },
  { name: "Retrieve", note: "vector + keyword search, fused in Postgres" },
  { name: "Rerank & grade", note: "is the evidence good enough?" },
  { name: "Generate", note: "answer only from the passages, with [n] citations" },
];

const link =
  "font-medium text-uoc-600 underline underline-offset-2 hover:text-magenta-600 dark:text-uoc-300 dark:hover:text-magenta-300";

const sections: LegalSection[] = [
  {
    id: "what",
    title: "What AskUoC is",
    body: (
      <>
        <p>
          AskUoC is a chat assistant that answers questions about the <strong>University of Cyberjaya</strong> -
          programmes, fees, scholarships, admission and campus life - and shows the pages it used so you can check them.
          It was built as a portfolio project to show how a careful, free-to-host retrieval-augmented generation (RAG)
          app can be designed, secured and made accessible.
        </p>
        <p>
          <strong>It is independent.</strong> It is not affiliated with, endorsed by or operated by the university. If
          it cannot find something in the university&apos;s public pages it says so instead of guessing, but it can
          still be wrong: verify anything important at{" "}
          <a href={UOC_URL} target="_blank" rel="noopener noreferrer">
            cyberjaya.edu.my
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "how",
    title: "How it works",
    body: (
      <>
        <p>
          The university&apos;s public web pages and documents are collected ahead of time, split into passages (fee
          tables become one passage per programme row so numbers stay attached to the right course), turned into
          embeddings and stored in a database. When you ask a question:
        </p>
        <ol className="not-prose my-5 grid gap-2 sm:grid-cols-5" aria-label="Answering pipeline">
          {steps.map((s, i) => (
            <li
              key={s.name}
              className="relative rounded-2xl border border-uoc-200/70 bg-white/50 p-3 text-sm dark:border-white/10 dark:bg-white/5"
            >
              <span
                className="mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-uoc-600 to-magenta-500 text-xs font-semibold text-white"
                aria-hidden
              >
                {i + 1}
              </span>
              <p className="font-semibold text-slate-900 dark:text-white">{s.name}</p>
              <p className="mt-0.5 text-xs leading-snug text-slate-600 dark:text-slate-400">{s.note}</p>
              {i < steps.length - 1 && (
                <ArrowRight
                  className="absolute -right-2.5 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-uoc-400 sm:block"
                  aria-hidden
                />
              )}
            </li>
          ))}
        </ol>
        <ul>
          <li>
            <strong>Corrective loop:</strong> if the first search finds weak evidence, it retries once with a broader
            query; if it still finds nothing relevant it says so and points you to the university.
          </li>
          <li>
            <strong>Grounded:</strong> the language model only sees the retrieved passages, must cite them, and refuses
            off-topic requests.
          </li>
          <li>
            <strong>Resilient:</strong> caches, fallbacks and rate limits keep it usable on free tiers, and it degrades
            gracefully instead of failing.
          </li>
          <li>
            <strong>Private by design:</strong> see the <Link href="/privacy">Privacy Policy</Link> for exactly what is
            stored and for how long.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "stack",
    title: "Tech stack",
    body: (
      <ul>
        <li>
          <strong>Web app:</strong> Next.js 16 (App Router), React 19, Tailwind CSS 4, pdf.js for in-browser PDF
          rendering.
        </li>
        <li>
          <strong>API:</strong> Python, FastAPI with server-sent-event streaming.
        </li>
        <li>
          <strong>AI:</strong> LangGraph / LangChain pipeline, Google Gemini (any OpenAI-compatible provider can be
          swapped in) for generation, vision and embeddings.
        </li>
        <li>
          <strong>Data:</strong> Postgres with pgvector (dense search) and full-text search, optional Redis cache.
        </li>
        <li>
          <strong>Speech:</strong> browser dictation and edge-tts for read-aloud.
        </li>
        <li>
          <strong>Hosting (free tiers):</strong> Vercel for the web app, Hugging Face Spaces for the API, Supabase for
          the database.
        </li>
      </ul>
    ),
  },
  {
    id: "data",
    title: "Data source and freshness",
    body: (
      <p>
        Answers come from public pages and documents on{" "}
        <a href={UOC_URL} target="_blank" rel="noopener noreferrer">
          cyberjaya.edu.my
        </a>
        . The chat footer shows the real date the content was last synced (&ldquo;Information is up to date as of
        &hellip;&rdquo;), and the assistant is told the same date. Anything published or changed after that date will
        not be reflected. Fees and dates in particular change - confirm them with the university.
      </p>
    ),
  },
  {
    id: "licences",
    title: "Open source and licences",
    body: (
      <>
        <p>
          The AskUoC code is open source under the <strong>MIT Licence</strong>
          {REPO_URL && (
            <>
              {" "}
              -{" "}
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                view the repository
              </a>
            </>
          )}
          . It stands on the shoulders of many open-source projects, mostly under MIT, BSD and Apache-2.0 licences. A
          few worth naming: the Geist fonts (SIL Open Font Licence 1.1), LGPL-3.0 libraries used unmodified through
          their public APIs (psycopg, edge-tts), and MPL-2.0 libraries (certifi, orjson). No AGPL code is used.
        </p>
        <p>
          University names, logos and content remain the property of the University of Cyberjaya (see the{" "}
          <Link href="/terms">Terms</Link>).
        </p>
      </>
    ),
  },
  {
    id: "credits",
    title: "Credits",
    body: (
      <>
        <p>
          Built by{" "}
          {AUTHOR_URL ? (
            <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer">
              {AUTHOR_NAME}
            </a>
          ) : (
            <strong>{AUTHOR_NAME}</strong>
          )}
          {OPERATOR_NAME !== AUTHOR_NAME && <>, operated by {OPERATOR_NAME}</>}. The purple and magenta palette is
          sampled from the University of Cyberjaya&apos;s public branding for familiarity; that does not imply
          endorsement.
        </p>
        <p>
          More:{" "}
          <Link href="/privacy" className={link}>
            Privacy
          </Link>{" "}
          ·{" "}
          <Link href="/terms" className={link}>
            Terms
          </Link>{" "}
          ·{" "}
          <Link href="/cookies" className={link}>
            Cookies
          </Link>{" "}
          ·{" "}
          <Link href="/accessibility" className={link}>
            Accessibility
          </Link>{" "}
          ·{" "}
          <Link href="/security" className={link}>
            Security
          </Link>
        </p>
      </>
    ),
  },
];

export default function AboutPage() {
  return (
    <LegalPage
      title="About AskUoC"
      intro="An independent, source-citing assistant for questions about the University of Cyberjaya - and a showcase of a small, careful RAG system."
      sections={sections}
      updated={null}
    />
  );
}
