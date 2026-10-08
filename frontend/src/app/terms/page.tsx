import type { Metadata } from "next";
import Link from "next/link";
import ContactLink from "@/components/site/ContactLink";
import LegalPage, { type LegalSection } from "@/components/site/LegalPage";
import { OPERATOR_NAME, REPO_URL, UOC_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of Use",
  description:
    "The rules for using AskUoC: acceptable use, AI accuracy disclaimer, accounts, intellectual property and liability.",
  alternates: { canonical: "/terms" },
};

const sections: LegalSection[] = [
  {
    id: "about",
    title: "About these terms",
    body: (
      <p>
        By using AskUoC you agree to these terms. AskUoC is a free, independent project run by {OPERATOR_NAME}{" "}
        (&ldquo;we&rdquo;). If you do not agree, please do not use it. Our <Link href="/privacy">Privacy Policy</Link>{" "}
        explains how data is handled.
      </p>
    ),
  },
  {
    id: "independent",
    title: "Independent project, not official advice",
    body: (
      <>
        <p>
          AskUoC is <strong>not affiliated with, endorsed by or operated by the University of Cyberjaya</strong>. It
          reads the university&apos;s public website and uses AI to write answers with links to the sources it used.
        </p>
        <p>
          <strong>Answers may be wrong, incomplete or out of date.</strong> AI models can make mistakes and the website
          may have changed since it was last synced (the date is shown in the chat). Nothing here is official, academic,
          financial, legal, immigration or admissions advice. Always confirm fees, deadlines, entry requirements and
          visa or scholarship conditions directly with the university (
          <a href={UOC_URL} target="_blank" rel="noopener noreferrer">
            cyberjaya.edu.my
          </a>
          ) before you rely on them or pay anything.
        </p>
      </>
    ),
  },
  {
    id: "use",
    title: "Acceptable use",
    body: (
      <>
        <p>Please use AskUoC fairly. You agree not to:</p>
        <ul>
          <li>break the law, or use it to harass, defame, deceive or harm anyone;</li>
          <li>upload or paste content you have no right to share, or anything unlawful or abusive;</li>
          <li>
            try to bypass rate limits, probe for vulnerabilities outside the{" "}
            <Link href="/security">responsible-disclosure</Link> rules, scrape it at scale or overload it;
          </li>
          <li>attempt to extract other people&apos;s data, or make it produce harmful content;</li>
          <li>present its answers as official university statements, or imply the university endorses AskUoC.</li>
        </ul>
        <p>We may limit or block access to protect the service, without notice.</p>
      </>
    ),
  },
  {
    id: "accounts",
    title: "Accounts",
    body: (
      <>
        <p>
          Accounts are optional. Keep your password private and use a strong, unique one - you are responsible for
          activity under your account. You can delete your account at any time from the{" "}
          <Link href="/profile">Profile</Link> page. We may disable accounts that break these terms.
        </p>
        <p>
          Shared conversation links are public to anyone who has them. Only share what you are comfortable with others
          reading; links expire after 90 days.
        </p>
      </>
    ),
  },
  {
    id: "availability",
    title: "Availability",
    body: (
      <p>
        AskUoC runs on free-tier hosting and third-party AI services, so it can be slow, rate limited, unavailable or
        changed at any time, and it may be shut down. There is no service-level commitment. Features such as read-aloud
        and attachments depend on third-party services.
      </p>
    ),
  },
  {
    id: "ip",
    title: "Intellectual property",
    body: (
      <>
        <p>
          <strong>University content.</strong> Names, logos, trademarks and the website text and documents that answers
          are drawn from belong to the University of Cyberjaya or its licensors. AskUoC uses them only to help people
          find and understand public information, with links back to the source. No licence to the university&apos;s
          marks is granted by these terms.
        </p>
        <p>
          <strong>Software.</strong> The AskUoC source code is released under the MIT Licence
          {REPO_URL ? (
            <>
              {" "}
              (
              <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">
                licence text
              </a>
              )
            </>
          ) : null}
          , and uses third-party open-source components under their own licences (see{" "}
          <Link href="/about#licences">About</Link>).
        </p>
        <p>
          <strong>Your content.</strong> You keep ownership of what you type. You give us permission to process it as
          described in the Privacy Policy so the service can work.
        </p>
      </>
    ),
  },
  {
    id: "liability",
    title: "Disclaimer and limit of liability",
    body: (
      <>
        <p>
          AskUoC is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind,
          including accuracy, completeness, fitness for a purpose or uninterrupted operation. To the fullest extent
          permitted by law, we are not liable for any loss or damage arising from use of, or reliance on, AskUoC or its
          answers, including decisions about study, fees or applications. Nothing in these terms limits liability that
          cannot lawfully be limited, or your statutory consumer rights.
        </p>
      </>
    ),
  },
  {
    id: "law",
    title: "Governing law",
    body: (
      <p>
        These terms are governed by the laws of Malaysia, and the courts of Malaysia have jurisdiction, unless mandatory
        law in your country of residence says otherwise.
        <em>
          {" "}
          (This is a placeholder for a personal project: it should be reviewed by a lawyer before any commercial use.)
        </em>
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes and contact",
    body: (
      <p>
        We may update these terms; the &ldquo;Last updated&rdquo; date shows when. Continued use means you accept the
        changes. Questions: <ContactLink subject="AskUoC terms" />.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      intro="Plain-English rules for using AskUoC. The important one: it is an AI helper, not the university - check anything that matters."
      sections={sections}
    />
  );
}
