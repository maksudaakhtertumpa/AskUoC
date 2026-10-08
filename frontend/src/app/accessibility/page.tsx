import type { Metadata } from "next";
import ContactLink from "@/components/site/ContactLink";
import LegalPage, { type LegalSection } from "@/components/site/LegalPage";
import { REPO_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Accessibility Statement",
  description:
    "How AskUoC supports keyboard, screen-reader, low-vision and mobile users, its known limitations, and how to report a barrier.",
  alternates: { canonical: "/accessibility" },
};

const sections: LegalSection[] = [
  {
    id: "commitment",
    title: "Our aim",
    body: (
      <p>
        We want AskUoC to be usable by as many people as possible. We aim for the Web Content Accessibility Guidelines
        (WCAG) 2.2 level AA. This is a small independent project that has not had a formal third-party audit, so this
        statement describes what we have built in and tested ourselves - not a certification.
      </p>
    ),
  },
  {
    id: "supported",
    title: "What is supported",
    body: (
      <ul>
        <li>
          <strong>Keyboard:</strong> every control can be reached and used from the keyboard; dialogs move focus in,
          restore it when closed and close with Escape; <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>K</kbd> opens chat search.
        </li>
        <li>
          <strong>Screen readers:</strong> semantic landmarks and headings, labelled buttons and icon controls, image
          alternatives for attachments, and live-region announcements for status messages.
        </li>
        <li>
          <strong>Contrast and themes:</strong> light and dark themes with text designed to meet 4.5:1 contrast; colour
          is never the only signal.
        </li>
        <li>
          <strong>Reduced motion:</strong> animations are shortened to near-instant when your system asks for reduced
          motion.
        </li>
        <li>
          <strong>Touch and mobile:</strong> touch targets of at least 44&times;44 px for the main controls, 16 px
          inputs so iOS does not zoom, safe-area support for notches, no horizontal scrolling at phone widths.
        </li>
        <li>
          <strong>Zoom and text size:</strong> layouts reflow and remain usable at 200% zoom and larger text settings;
          content is not locked to one orientation.
        </li>
        <li>
          <strong>Alternatives to voice and reading:</strong> you can type instead of dictating, and answers can be read
          aloud or copied as text.
        </li>
        <li>
          <strong>No time limits</strong> on reading or typing, and no flashing content.
        </li>
      </ul>
    ),
  },
  {
    id: "limitations",
    title: "Known limitations",
    body: (
      <ul>
        <li>
          Focus indicators in the chat rely largely on browser defaults and could be stronger; dialogs do not yet fully
          trap Tab focus.
        </li>
        <li>
          Answers stream in gradually and are typed out on screen; screen-reader users may find long answers easier to
          read once complete (they can also copy them).
        </li>
        <li>
          Answers are AI-generated. They can contain tables, links and citation badges whose structure varies from reply
          to reply.
        </li>
        <li>
          Glass (blurred, translucent) surfaces can reduce contrast on some browsers or when &ldquo;reduce
          transparency&rdquo; is on; text colours are chosen conservatively but we have not tested every combination.
        </li>
        <li>
          Dictation and read-aloud rely on your browser and third-party services and are not available everywhere.
        </li>
        <li>
          Source documents on the university website (for example PDFs) are outside our control and may not be
          accessible.
        </li>
        <li>We have tested with keyboard and a limited set of screen readers and browsers, not the full range.</li>
      </ul>
    ),
  },
  {
    id: "feedback",
    title: "Report a problem",
    body: (
      <>
        <p>
          If something is hard or impossible to use, please tell us what you were trying to do, the page, your
          browser/device and any assistive technology. Contact: <ContactLink subject="AskUoC accessibility feedback" />
          {REPO_URL && (
            <>
              {" "}
              or{" "}
              <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer">
                open an issue
              </a>
            </>
          )}
          . We aim to respond within 7 days and to fix reported barriers as quickly as a volunteer project can.
        </p>
        <p>
          For anything about the university itself (its own website, forms or services), contact the University of
          Cyberjaya directly.
        </p>
      </>
    ),
  },
];

export default function AccessibilityPage() {
  return (
    <LegalPage
      title="Accessibility Statement"
      intro="AskUoC should work for everyone - by keyboard, screen reader, on a phone, in dark mode or zoomed in. Here is what we support and where we fall short."
      sections={sections}
    />
  );
}
