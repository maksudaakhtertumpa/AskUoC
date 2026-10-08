import { API_URL } from "./api";

/** Speech: dictation (SpeechRecognition) and read-aloud (server edge-tts, browser voices as fallback). */

type RecognitionResultList = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
type RecognitionEvent = { resultIndex: number; results: RecognitionResultList };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

const recognitionCtor = (): RecognitionCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const dictationSupported = () => recognitionCtor() !== null;
export const speechOutputSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. Allow it in your browser's site settings to dictate.",
  "service-not-allowed": "Microphone access was blocked. Allow it in your browser's site settings to dictate.",
  "no-speech": "I didn't hear anything - try again.",
  "audio-capture": "No microphone was found.",
  network: "Dictation isn't available here - it needs Chrome or Edge with an internet connection. You can still type.",
};

export type Dictation = { stop: () => void };

/** Start dictation. `onText` receives the full transcript so far (interim + final). */
export function startDictation(o: {
  onText: (transcript: string) => void;
  onEnd: () => void;
  onError: (message: string, code: string) => void;
}): Dictation | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = navigator.language || "en-US";
  r.continuous = true;
  r.interimResults = true;
  r.onresult = (e) => {
    let text = "";
    for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
    o.onText(text.trim());
  };
  r.onerror = (e) => {
    if (e.error !== "aborted") o.onError(ERRORS[e.error] ?? "Dictation stopped unexpectedly.", e.error);
  };
  r.onend = o.onEnd;
  r.start();
  return { stop: () => r.stop() };
}

let generation = 0;
let audio: HTMLAudioElement | null = null;
let audioUrl: string | null = null;
let fetchCtl: AbortController | null = null;

export function stopSpeaking(): void {
  generation++;
  fetchCtl?.abort();
  fetchCtl = null;
  if (audio) {
    audio.pause();
    audio.src = "";
    audio = null;
  }
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
    audioUrl = null;
  }
  if (speechOutputSupported()) window.speechSynthesis.cancel();
}

/** Fallback: the browser's own voices (some systems ship none). */
function speakWithBrowser(text: string, onEnd: () => void): void {
  if (!speechOutputSupported()) return onEnd();
  const u = new SpeechSynthesisUtterance(plainForSpeech(text).slice(0, 3500));
  u.lang = navigator.language || "en-US";
  u.onend = onEnd;
  u.onerror = onEnd;
  window.speechSynthesis.speak(u);
}

/** Markdown answer to text that sounds natural when spoken. */
export function plainForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[\d+\]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, "")
    .replace(/\|/g, ", ")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Read an answer aloud with the server voice, else browser voices. `onEnd` fires on finish, failure or stop. */
export async function speak(text: string, cb: { onStart: () => void; onEnd: () => void }): Promise<void> {
  stopSpeaking();
  const mine = generation;
  const ctl = new AbortController();
  fetchCtl = ctl;
  try {
    const res = await fetch(`${API_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`tts ${res.status}`);
    const blob = await res.blob();
    if (generation !== mine) return;
    audioUrl = URL.createObjectURL(blob);
    audio = new Audio(audioUrl);
    audio.onended = () => generation === mine && cb.onEnd();
    audio.onerror = () => generation === mine && speakWithBrowser(text, cb.onEnd);
    await audio.play();
    if (generation === mine) cb.onStart();
  } catch (e) {
    if (generation !== mine || (e as Error).name === "AbortError") return;
    cb.onStart();
    speakWithBrowser(text, cb.onEnd);
  }
}
