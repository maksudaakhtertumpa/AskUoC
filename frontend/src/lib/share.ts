import type { ShareSnapshot } from "./api";
import type { Conversation } from "./history";
import { plainText } from "./text";

const KEY = "askuoc_shares_v1";
export type ShareRecord = { id: string; token: string; createdAt: number };

export const loadShares = (): Record<string, ShareRecord> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
};
export const saveShare = (convId: string, rec: ShareRecord | null) => {
  const all = loadShares();
  if (rec) all[convId] = rec;
  else delete all[convId];
  localStorage.setItem(KEY, JSON.stringify(all));
};

/** What gets published: text, quotes and source links only, never attachments. */
export function toSnapshot(c: Conversation): ShareSnapshot {
  return {
    title: c.title.slice(0, 120),
    messages: c.messages
      .filter((m) => m.content && !m.error)
      .map((m) => ({
        role: m.role,
        content: m.content.slice(0, 8000),
        quote: m.quote?.slice(0, 1500),
        sources: m.sources
          .slice(0, 10)
          .map(({ n, title, url, doc_type }) => ({ n, title: title.slice(0, 200), url, doc_type })),
      }))
      .slice(-80),
  };
}

/** Markdown transcript for Copy / Download. */
export function toMarkdown(c: Conversation): string {
  const lines = [`# ${c.title}`, "", "_AskUoC - University of Cyberjaya assistant_", ""];
  for (const m of c.messages.filter((x) => x.content && !x.error)) {
    lines.push(m.role === "user" ? "**You**" : "**AskUoC**", "");
    if (m.quote) lines.push(`> ${plainText(m.quote)}`, "");
    lines.push(m.content, "");
    const cited = m.sources.filter((s) => m.content.includes(`[${s.n}]`));
    if (cited.length) lines.push(...cited.map((s) => `- [${s.n}] [${s.title}](${s.url})`), "");
  }
  return lines.join("\n").trim() + "\n";
}

export function downloadText(filename: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  a.download =
    filename
      .replace(/[^\w\- ]+/g, "")
      .trim()
      .slice(0, 60)
      .replace(/\s+/g, "-") + ".md";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
