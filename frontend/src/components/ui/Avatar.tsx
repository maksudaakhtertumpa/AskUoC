/* eslint-disable @next/next/no-img-element */
import type { PublicUser } from "@/lib/http";

const TONES = [
  "from-uoc-600 to-magenta-500",
  "from-uoc-500 to-teal-500",
  "from-magenta-500 to-sun-500",
  "from-uoc-700 to-uoc-400",
  "from-teal-600 to-uoc-500",
];

/** Profile photo, else their initial on a colour derived from the username. */
export default function Avatar({
  user,
  src,
  size = 32,
  className = "",
}: {
  user: Pick<PublicUser, "username" | "display_name">;
  src?: string;
  size?: number;
  className?: string;
}) {
  const name = (user.display_name || user.username || "?").trim();
  const initial = Array.from(name)[0]?.toUpperCase() ?? "?";
  const tone = TONES[[...user.username].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (src)
    return (
      <img
        src={src}
        alt=""
        style={style}
        className={`shrink-0 rounded-full object-cover ring-2 ring-white/70 dark:ring-white/15 ${className}`}
      />
    );
  return (
    <span
      aria-hidden
      style={style}
      className={`flex shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white ring-2 ring-white/70 dark:ring-white/15 ${tone} ${className}`}
    >
      {initial}
    </span>
  );
}
