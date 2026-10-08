import { Award, Banknote, Building2, Globe, Sparkles, type LucideIcon } from "lucide-react";
import Footer from "./Footer";

const SUGGESTIONS: { text: string; Icon: LucideIcon; tile: string }[] = [
  {
    text: "What are the fees for the Diploma in Information Technology?",
    Icon: Banknote,
    tile: "from-teal-400 to-emerald-500",
  },
  { text: "What scholarships are available for nursing students?", Icon: Award, tile: "from-sun-400 to-sun-500" },
  { text: "How do international students apply?", Icon: Globe, tile: "from-uoc-500 to-uoc-700" },
  { text: "What facilities are there on campus?", Icon: Building2, tile: "from-magenta-400 to-magenta-600" },
];

export function Greeting() {
  return (
    <div className="mb-6 animate-rise text-center sm:mb-8">
      <div className="relative mx-auto mb-4 h-14 w-14 sm:h-16 sm:w-16">
        <span className="absolute inset-0 animate-ping-slow rounded-3xl bg-magenta-500/25" aria-hidden />
        <div className="relative flex h-full w-full items-center justify-center rounded-3xl bg-gradient-to-br from-uoc-600 to-magenta-500 text-white shadow-xl shadow-uoc-600/30">
          <Sparkles className="h-7 w-7" />
        </div>
      </div>
      <h2 className="text-[1.65rem] font-semibold leading-tight tracking-tight sm:text-4xl">
        What can I help you <span className="gradient-text">with</span>?
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">
        Programmes, fees, scholarships, admission and campus life at the University of Cyberjaya.
      </p>
    </div>
  );
}

export function Suggestions({ onPick }: { onPick: (q: string) => void }) {
  return (
    <ul className="mt-5 grid w-full max-w-3xl gap-2.5 sm:grid-cols-2">
      {SUGGESTIONS.map(({ text, Icon, tile }, i) => (
        <li key={text} className="animate-rise" style={{ animationDelay: `${120 + i * 70}ms` }}>
          <button
            onClick={() => onPick(text)}
            className="glass group flex h-full w-full items-center gap-3 rounded-2xl p-3 text-left text-sm text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:!bg-white/70 active:scale-[0.99] dark:text-slate-200 dark:hover:!bg-white/10"
          >
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md transition group-hover:scale-110 ${tile}`}
            >
              <Icon className="h-5 w-5" />
            </span>
            <span className="leading-snug">{text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function WelcomeFooter({ dataDate }: { dataDate: string | null }) {
  return (
    <div className="absolute inset-x-0 bottom-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <Footer dataDate={dataDate} />
    </div>
  );
}
