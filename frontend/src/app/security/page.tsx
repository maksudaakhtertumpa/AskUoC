import type { Metadata } from "next";
import Link from "next/link";
import ContactLink from "@/components/site/ContactLink";
import DataTable from "@/components/site/DataTable";
import LegalPage, { type LegalSection } from "@/components/site/LegalPage";
import { REPO_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How to report a security vulnerability in AskUoC, what is in scope, and a summary of its security model.",
  alternates: { canonical: "/security" },
};

const sections: LegalSection[] = [
  {
    id: "report",
    title: "Reporting a vulnerability",
    body: (
      <>
        <p>
          Please <strong>do not open a public issue</strong> for security problems.{" "}
          {REPO_URL ? (
            <>
              Use GitHub&apos;s private{" "}
              <a href={`${REPO_URL}/security/advisories/new`} target="_blank" rel="noopener noreferrer">
                &ldquo;Report a vulnerability&rdquo;
              </a>{" "}
              form on the repository, or{" "}
            </>
          ) : null}
          contact <ContactLink subject="AskUoC security report" />.
        </p>
        <p>
          We aim to acknowledge reports within 3 working days and to fix confirmed high-severity issues within 14 days.
          Please give us reasonable time to fix before you disclose. Machine-readable details:{" "}
          <a href="/.well-known/security.txt">/.well-known/security.txt</a>.
        </p>
        <p>
          Good-faith research is welcome. Please do not access other people&apos;s data, degrade the service, or run
          high-volume automated scans against the public demo.
        </p>
      </>
    ),
  },
  {
    id: "scope",
    title: "Scope",
    body: (
      <p>
        In scope: the API, the web app, the ingestion pipeline and the deployment configuration in the repository. Out
        of scope: the University of Cyberjaya&apos;s own website, third-party services (Google, Supabase, Vercel,
        Hugging Face, Redis providers) and social engineering. To report a problem with the university&apos;s systems,
        contact the university.
      </p>
    ),
  },
  {
    id: "model",
    title: "Security model in brief",
    body: (
      <>
        <DataTable
          caption="Security measures"
          head={["Area", "Approach"]}
          rows={[
            [
              "Passwords",
              "scrypt with a per-user salt, constant-time comparison, minimum length, lockout after repeated failures.",
            ],
            [
              "Sessions",
              "Signed, expiring bearer tokens; revoked when the password changes or the account is disabled. No cookies, so no CSRF surface.",
            ],
            ["Roles", "user / staff / admin, enforced on the server for every admin endpoint."],
            ["Secrets", "Keys entered in the admin console are encrypted at rest and never sent back to the browser."],
            [
              "Input / output",
              "Validated and size-capped; uploads checked by magic bytes; Markdown rendered without raw HTML; only safe link schemes survive.",
            ],
            ["Abuse", "Per-IP and per-account rate limits, request size limits, graceful handling of provider quotas."],
            [
              "Browser hardening",
              "Content-Security-Policy, HSTS, frame denial, nosniff, referrer and permissions policies; shared pages are noindex.",
            ],
          ]}
        />
        <p>
          No system is perfectly secure. For what data goes where, see the <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </>
    ),
  },
];

export default function SecurityPage() {
  return (
    <LegalPage
      title="Security"
      intro="Found something? Thank you - here is how to tell us safely."
      sections={sections}
      showDisclaimer={false}
    />
  );
}
