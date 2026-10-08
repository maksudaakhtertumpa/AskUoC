import type { Source } from "./api";

/** Passage number -> the number shown to the reader. The model cites passages [1]..[5]; readers see 1, 2, 3 in reading order. */
export function citationNumbers(text: string, sources: Source[]): Map<number, number> {
  const known = new Set(sources.map((s) => s.n));
  const shown = new Map<number, number>();
  for (const m of text.matchAll(/\[(\d+)\]/g)) {
    const n = Number(m[1]);
    if (known.has(n) && !shown.has(n)) shown.set(n, shown.size + 1);
  }
  return shown;
}
