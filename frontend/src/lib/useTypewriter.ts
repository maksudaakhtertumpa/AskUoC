import { useEffect, useRef, useState } from "react";

const THINK_MS = 650; // minimum time the typing dots show before any text
const BASE_CPS = 75; // characters per second
const MAX_CPS = 650;

/** Reveal `text` progressively so bursty streamed tokens never pop in. `animate` is fixed at mount. */
export function useTypewriter(text: string, streamDone: boolean, animate: boolean) {
  const [n, setN] = useState(animate ? 0 : text.length);
  const textRef = useRef(text);
  const doneRef = useRef(streamDone);

  useEffect(() => {
    textRef.current = text;
    doneRef.current = streamDone;
  }, [text, streamDone]);

  useEffect(() => {
    if (!animate) return;
    const start = performance.now();
    let last = start;
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      const len = textRef.current.length;
      if (now - start >= THINK_MS) {
        setN((prev) => {
          if (prev >= len) return prev;
          const backlog = len - prev;
          const cps = Math.min(MAX_CPS, BASE_CPS + backlog * 0.7); // catch up when far behind
          return Math.min(len, prev + Math.max(1, Math.round((cps * dt) / 1000)));
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  const shown = animate ? text.slice(0, n) : text;
  return { shown, typing: animate && (!streamDone || n < text.length) };
}
