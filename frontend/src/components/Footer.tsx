import { AUTHOR_NAME, AUTHOR_URL, SITE_URL } from "@/lib/site";

const link =
  "font-medium text-uoc-600 underline decoration-uoc-300 underline-offset-2 transition hover:text-magenta-600 hover:decoration-magenta-400 dark:text-uoc-300 dark:decoration-uoc-600 dark:hover:text-magenta-300";

/** Data freshness (last website sync) and credit; legal links live in the sidebar. */
export default function Footer({ dataDate }: { dataDate: string | null }) {
  return (
    <p className="text-center text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
      Answers from{" "}
      <a href={SITE_URL} target="_blank" rel="noopener noreferrer" className={link}>
        cyberjaya.edu.my
      </a>
      {dataDate && (
        <>
          {" "}
          · <span className="sm:hidden">Updated</span>
          <span className="hidden sm:inline">Information is up to date as of</span>{" "}
          <strong className="whitespace-nowrap font-bold text-slate-600 dark:text-slate-300">{dataDate}</strong>
        </>
      )}
      <br className="sm:hidden" />
      <span className="hidden sm:inline"> · </span>
      Built by{" "}
      {AUTHOR_URL ? (
        <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer" className={link}>
          {AUTHOR_NAME}
        </a>
      ) : (
        // placeholder link until NEXT_PUBLIC_AUTHOR_URL is set
        <a href="#" title="Website coming soon" className={link}>
          {AUTHOR_NAME}
        </a>
      )}
    </p>
  );
}
