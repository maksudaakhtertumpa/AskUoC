import type { Metadata } from "next";
import Link from "next/link";
import ContactLink from "@/components/site/ContactLink";
import DataTable from "@/components/site/DataTable";
import LegalPage, { type LegalSection } from "@/components/site/LegalPage";
import { OPERATOR_NAME, REPO_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What AskUoC collects, why, who receives it, how long it is kept and how to access, export or delete your data. Plain English, GDPR and Malaysia PDPA 2010 aware.",
  alternates: { canonical: "/privacy" },
};

const sections: LegalSection[] = [
  {
    id: "who",
    title: "Who runs AskUoC",
    body: (
      <>
        <p>
          AskUoC is run by <strong>{OPERATOR_NAME}</strong> (&ldquo;we&rdquo;, &ldquo;us&rdquo;) as an independent,
          non-commercial portfolio project. For the purposes of data-protection law (the EU/UK GDPR and Malaysia&apos;s
          Personal Data Protection Act 2010, &ldquo;PDPA&rdquo;) we are the data controller / data user for the
          information described here. Contact for anything privacy-related:{" "}
          <ContactLink subject="AskUoC privacy request" />.
        </p>
        <p>
          <strong>AskUoC is not the University of Cyberjaya.</strong> It is not affiliated with, endorsed by or operated
          by the university, and the university does not receive your questions from us.
        </p>
      </>
    ),
  },
  {
    id: "summary",
    title: "The short version",
    body: (
      <ul>
        <li>
          You can use the chat without an account. Your conversation history stays <strong>in your browser</strong>.
        </li>
        <li>
          Your questions are sent to our server, answered by an AI provider, and a copy of the question and answer is
          logged for up to <strong>90 days</strong>. That log has{" "}
          <strong>no IP address, no user agent and no link to your account</strong>.
        </li>
        <li>
          We set <strong>no cookies</strong>, and use <strong>no advertising or analytics trackers</strong>. See{" "}
          <Link href="/cookies">Cookies &amp; local storage</Link>.
        </li>
        <li>
          An account is optional. If you create one we store a username, display name, optional picture and a password
          hash, plus the chats you choose to sync.
        </li>
        <li>
          You can download or delete your data yourself on the <Link href="/profile">Profile</Link> page.
        </li>
        <li>
          Please do not type sensitive personal information (ID numbers, health or financial details) into the chat.
        </li>
      </ul>
    ),
  },
  {
    id: "collect",
    title: "What we collect, why, and on what basis",
    body: (
      <>
        <p>
          &ldquo;Legal basis&rdquo; is the GDPR term for our justification. Under the PDPA the equivalent is that
          processing is needed to give you the service you asked for, or for a legitimate purpose directly related to
          it, and (where an account is created) that you consented by signing up.
        </p>
        <DataTable
          caption="Personal data, purpose and legal basis"
          head={["Data", "What / where", "Why", "Legal basis"]}
          rows={[
            [
              "Questions and answers",
              "The text of each question and the answer, the outcome (answered / not found), source links, response time, whether it came from cache, and a random conversation ID. Stored in our database. No IP address, no user agent, no username.",
              "To give you an answer, review answer quality, find gaps in the knowledge base and investigate abuse.",
              "Performing the service you request; legitimate interests (improving and securing the service).",
            ],
            [
              "Conversation memory",
              "So follow-up questions make sense, the recent turns of a conversation are held by the server against the random conversation ID - in memory by default (lost on restart), or in the database if the operator enables persistent memory.",
              "Multi-turn answers.",
              "Performing the service you request.",
            ],
            [
              "Attachments (images, PDF pages)",
              "Resized in your browser and sent once to the AI provider to be transcribed to text. The images themselves are never stored by us; only the resulting text is used for that answer (and the answer may quote it, like any other reply).",
              "So you can ask about a document or photo.",
              "Performing the service you request (you choose to attach).",
            ],
            [
              "Feedback",
              "A thumbs-up / thumbs-down linked to that answer's log entry.",
              "Measure answer quality.",
              "Legitimate interests.",
            ],
            [
              "Account (optional)",
              "Username, display name, optional profile picture, role, account timestamps, and a password hash (scrypt with a per-user salt). We never store your password itself.",
              "Sign-in and syncing.",
              "Contract / your consent when you register.",
            ],
            [
              "Synced conversations (signed-in only)",
              "Your chats, stored server-side against your account so they appear on your other devices. Attachment thumbnails are not synced.",
              "Same history on all devices.",
              "Your consent (you sign in) and performing the service.",
            ],
            [
              "Shared conversations",
              "If you press Share: a public snapshot (title, messages, source links - never attachments) at an unguessable link, plus a hash of the secret delete token. The token itself stays in your browser.",
              "The link you chose to create.",
              "Your consent (you create the link).",
            ],
            [
              "IP address (transient)",
              "Used as a key for rate limiting in Redis or memory, and expires in about a minute. It is not written to our logs or database.",
              "Prevent abuse and protect the free-tier quota.",
              "Legitimate interests (security).",
            ],
            [
              "Server logs",
              "One line per request: method, path, status code and duration. No IP, no user agent, no request body, no query string.",
              "Reliability and debugging.",
              "Legitimate interests.",
            ],
            [
              "Admin audit log (staff only)",
              "Which staff account changed a setting, uploaded or deleted content. Contains no secrets or chat content.",
              "Accountability.",
              "Legitimate interests.",
            ],
          ]}
        />
        <p>
          Some data also lives only on your device (chat history, theme, sign-in token, share tokens). It never reaches
          us unless you sync or share. The exact list is on the <Link href="/cookies">Cookies &amp; local storage</Link>{" "}
          page.
        </p>
      </>
    ),
  },
  {
    id: "recipients",
    title: "Who else receives data (processors)",
    body: (
      <>
        <p>
          We use these services to run AskUoC. They act on our instructions, under their own terms and privacy policies.
        </p>
        <DataTable
          caption="Third-party recipients"
          head={["Provider", "What they receive", "When"]}
          rows={[
            [
              "Google (Gemini API)",
              "Your question, the passages retrieved from the university website, recent turns of the conversation, and any attached images / PDF pages.",
              "When the language-model or embedding provider is Gemini. On Google's free tier, Google's terms may allow it to use submitted content to improve its products.",
            ],
            [
              "Another OpenAI-compatible provider",
              "The same as above.",
              "Only if the operator configures one (for example OpenAI, Groq, OpenRouter or a self-hosted model).",
            ],
            [
              "Microsoft (Edge text-to-speech)",
              "The text of the answer you ask to hear (via our server). The audio is cached by a hash of the text, not tied to you.",
              "Only when you press Read aloud.",
            ],
            [
              "Your browser vendor",
              "Your voice, if you use dictation: the browser's own speech recognition (for example Google in Chrome) handles it. We only receive the resulting text.",
              "Only when you press the microphone button.",
            ],
            ["Database host (Supabase)", "All stored data described above.", "Always (database)."],
            [
              "Redis provider (for example Upstash)",
              "Temporary cache entries (answers, embeddings, audio, keyed by hashed text and never tied to a person) and rate-limit counters.",
              "If Redis caching is enabled.",
            ],
            [
              "Web and API hosts (for example Vercel, Hugging Face)",
              "Standard request logs kept by the host - typically IP address, user agent and URL - under the host's own retention.",
              "Every request.",
            ],
          ]}
        />
        <p>
          <strong>International transfers.</strong> These providers may process data outside Malaysia, including in the
          United States and elsewhere. By using AskUoC you understand your questions leave your country when they are
          answered. We do not sell your data and do not share it for advertising.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it",
    body: (
      <DataTable
        caption="Retention periods"
        head={["Data", "Kept for"]}
        rows={[
          [
            "Question and answer logs, and feedback",
            "Deleted automatically after 90 days (a maintenance job runs every few hours).",
          ],
          ["Shared conversation links", "Expire and are deleted after 90 days, or sooner if you delete the link."],
          ["Admin audit log", "365 days."],
          ["Account and synced conversations", "Until you delete a chat or your account."],
          [
            "Sign-in session",
            "30 days for ordinary users (12 hours for staff), or until you sign out or change your password.",
          ],
          ["Rate-limit counters (contain IP)", "About one minute."],
          ["Caches (answers, embeddings, retrieval, audio)", "1 hour to 7 days, then expire."],
          [
            "Conversation memory on the server",
            "In memory it is lost whenever the server restarts. If persistent memory is enabled it is kept in the database until the operator clears it (this store is not covered by the 90-day purge).",
          ],
          ["Data on your device", "Until you delete it or clear your browser data."],
          [
            "Backups and provider logs",
            "Held by our hosts under their own schedules; deleted data can remain in provider backups for a short time.",
          ],
        ]}
      />
    ),
  },
  {
    id: "rights",
    title: "Your rights and how to use them",
    body: (
      <>
        <p>
          Depending on where you live you can access, correct, delete, restrict or object to our use of your data, ask
          for a portable copy, and withdraw consent at any time.
        </p>
        <ul>
          <li>
            <strong>Download your data</strong> - <Link href="/profile">Profile</Link> &rarr; &ldquo;Download my
            data&rdquo; (account details and synced conversations as JSON).
          </li>
          <li>
            <strong>Correct it</strong> - change your display name and picture on the Profile page.
          </li>
          <li>
            <strong>Delete it</strong> - delete single chats, all chats, share links, or your entire account (which also
            removes your synced conversations) from the same page. Deleting the local copy is done from the chat sidebar
            or by clearing your browser data.
          </li>
          <li>
            <strong>Anything else</strong> (objecting, restricting, or a request about the question log) - write to{" "}
            <ContactLink subject="AskUoC privacy request" />. We aim to reply within 30 days.
          </li>
        </ul>
        <p>
          <strong>About the question log.</strong> Because we deliberately do not attach your IP address or account to
          logged questions, we usually cannot tell which entries are yours. If you want a specific entry removed, tell
          us the exact wording and roughly when you asked it. Everything is deleted after 90 days anyway.
        </p>
        <p>
          If you are unhappy with how we handle your data, please contact us first. You may also complain to the
          Personal Data Protection Commissioner of Malaysia (JPDP), or, if you are in the EU/UK, to your local
          supervisory authority.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p>
        AskUoC is aimed at prospective and current students and is not directed at children under 13. We do not
        knowingly collect their personal data. If you are under 18, please ask a parent or guardian before creating an
        account or sharing personal information. If you think a child has given us data, contact us and we will delete
        it.
      </p>
    ),
  },
  {
    id: "security",
    title: "How we protect data",
    body: (
      <>
        <ul>
          <li>
            Passwords are hashed with scrypt (memory-hard, per-user salt); sign-in attempts are rate limited and
            accounts lock after repeated failures.
          </li>
          <li>
            Sessions are signed, expiring tokens kept in your browser (not cookies), revoked when you change your
            password.
          </li>
          <li>Roles are enforced on the server; API keys entered by staff are encrypted at rest.</li>
          <li>
            Traffic is served over HTTPS with security headers (CSP, HSTS, frame protection); shared pages are hidden
            from search engines and only link to the university website.
          </li>
          <li>Access logs deliberately omit IP addresses and user agents; logs expire automatically.</li>
        </ul>
        <p>
          No system is completely secure, and this is a small hobby-scale service. See the{" "}
          <Link href="/security">security page</Link> to report a problem.
          {REPO_URL && (
            <>
              {" "}
              The{" "}
              <a href={`${REPO_URL}/blob/main/docs/DATA-MAP.md`} target="_blank" rel="noopener noreferrer">
                data map
              </a>{" "}
              in the open-source repository lists every data flow.
            </>
          )}
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        If we change how data is handled we will update this page and the &ldquo;Last updated&rdquo; date above.
        Continued use after a change means you accept the updated policy.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Privacy questions and requests: <ContactLink subject="AskUoC privacy request" />. Operator: {OPERATOR_NAME}.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="This page explains, in plain English, what AskUoC does with information about you. It describes what the software actually does today."
      sections={sections}
    />
  );
}
