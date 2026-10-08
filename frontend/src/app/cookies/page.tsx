import type { Metadata } from "next";
import Link from "next/link";
import DataTable from "@/components/site/DataTable";
import LegalPage, { type LegalSection } from "@/components/site/LegalPage";

export const metadata: Metadata = {
  title: "Cookies & Local Storage",
  description:
    "AskUoC sets no cookies. This page lists the few items it keeps in your browser's local storage, why, and for how long.",
  alternates: { canonical: "/cookies" },
};

const code =
  "rounded bg-uoc-100/80 px-1.5 py-0.5 font-mono text-[0.85em] text-uoc-800 dark:bg-white/10 dark:text-uoc-100";
const K = ({ children }: { children: string }) => <code className={code}>{children}</code>;

const sections: LegalSection[] = [
  {
    id: "cookies",
    title: "We set no cookies",
    body: (
      <>
        <p>
          AskUoC does not set or read any cookies - not for sign-in, not for analytics, not for advertising. Because of
          that there is no cookie banner: there is nothing to consent to. Signed-in sessions use a token kept in local
          storage and sent in a request header, which also means there is no cookie-based CSRF surface.
        </p>
      </>
    ),
  },
  {
    id: "storage",
    title: "What is kept in your browser",
    body: (
      <>
        <p>
          The app stores a few items in your browser&apos;s <strong>local storage</strong>. They stay on your device,
          are only read by AskUoC pages from this site, and are strictly necessary for features you use (history,
          sign-in, appearance). They stay until you remove them - see &ldquo;Clearing it&rdquo; below.
        </p>
        <DataTable
          caption="Local storage keys used by AskUoC"
          head={["Key", "What it holds", "Purpose", "Duration"]}
          rows={[
            [
              <K key="h">askuoc_history_v1</K>,
              "Your conversations (messages, sources, titles, pin/archive flags, small attachment thumbnails), newest 30.",
              "Show your past chats without an account.",
              "Until you delete the chats or clear browser data.",
            ],
            [
              <K key="s">askuoc_sidebar_v1</K>,
              "0 or 1: whether the sidebar is open on desktop.",
              "Remember your layout.",
              "Until changed or cleared.",
            ],
            [
              <K key="t">askuoc_theme</K>,
              "light or dark.",
              "Remember your theme choice (otherwise your system setting is used).",
              "Until changed or cleared.",
            ],
            [
              <K key="se">askuoc_session_v1</K>,
              "Only if you sign in: session token, username, role and display name.",
              "Keep you signed in.",
              "Token expires after 30 days (12 hours for staff); removed when you sign out.",
            ],
            [
              <K key="sh">askuoc_shares_v1</K>,
              "Only if you share a chat: the share ID and the secret delete token for each link.",
              "Let you delete a link you created.",
              "Until you delete the link or clear browser data.",
            ],
          ]}
        />
        <p>
          None of these are used to track you across sites. They are not shared with third parties by us. The chat
          history and share tokens never leave your device unless you choose to sync (signed-in) or share a
          conversation. Nothing is written to session storage, IndexedDB or the Cache API.
        </p>
      </>
    ),
  },
  {
    id: "tracking",
    title: "No tracking, analytics or ads",
    body: (
      <ul>
        <li>No analytics scripts, tracking pixels, fingerprinting or advertising networks.</li>
        <li>Fonts are bundled with the site (no Google Fonts request from your browser).</li>
        <li>
          The Content-Security-Policy restricts the page to our own origin and our API, so third-party scripts cannot
          load.
        </li>
        <li>
          Our hosts keep ordinary server logs (see the <Link href="/privacy">Privacy Policy</Link>).
        </li>
      </ul>
    ),
  },
  {
    id: "clearing",
    title: "Clearing it",
    body: (
      <ul>
        <li>Delete chats from the sidebar (or all chats from Profile); sign out to remove the session token.</li>
        <li>
          Or clear this site&apos;s data in your browser settings (usually under Privacy &rarr; Site data). That removes
          everything listed above.
        </li>
        <li>
          Clearing history on this device does not delete chats you synced to your account - delete those from the
          Profile page.
        </li>
      </ul>
    ),
  },
];

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookies & Local Storage"
      intro="Short version: no cookies, no trackers. Here is exactly what the app keeps in your browser and why."
      sections={sections}
    />
  );
}
