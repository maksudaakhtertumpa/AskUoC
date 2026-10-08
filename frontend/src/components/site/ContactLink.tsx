import { CONTACT_EMAIL, REPO_URL } from "@/lib/site";

/** Inline "how to reach the operator" text; degrades when no email is configured. */
export default function ContactLink({ subject }: { subject?: string }) {
  if (CONTACT_EMAIL) {
    const href = `mailto:${CONTACT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
    return <a href={href}>{CONTACT_EMAIL}</a>;
  }
  if (REPO_URL) {
    return (
      <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer">
        the project&apos;s issue tracker
      </a>
    );
  }
  return <>the operator (contact details are published by whoever hosts this deployment)</>;
}
