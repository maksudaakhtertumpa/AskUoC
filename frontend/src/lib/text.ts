/** Markdown to plain text, for quoting an answer. */
export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[\d+\]/g, "") // citation badges
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links -> label
    .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, "") // table separator rows
    .replace(/\s*\|\s*/g, " · ") // table cells
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[*_`>~]/g, "")
    .replace(/^\s*[-•]\s+/gm, "• ")
    .replace(/\s+/g, " ")
    .trim();
}
