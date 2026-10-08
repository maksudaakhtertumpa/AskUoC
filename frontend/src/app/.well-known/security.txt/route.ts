import { APP_URL, CONTACT_EMAIL, REPO_URL } from "@/lib/site";

// rendered per request: RFC 9116 requires `Expires` to be in the future
export const dynamic = "force-dynamic";

export function GET() {
  const expires = new Date(Date.now() + 364 * 24 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const contacts = [
    CONTACT_EMAIL && `mailto:${CONTACT_EMAIL}`,
    REPO_URL && `${REPO_URL}/security/advisories/new`,
    `${APP_URL}/security`, // RFC 9116 requires at least one Contact
  ].filter(Boolean);

  const body = [
    "# AskUoC security contact (RFC 9116). AskUoC is an independent project, not run by the University of Cyberjaya.",
    ...contacts.map((c) => `Contact: ${c}`),
    `Expires: ${expires}`,
    "Preferred-Languages: en, ms",
    `Canonical: ${APP_URL}/.well-known/security.txt`,
    `Policy: ${APP_URL}/security`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
