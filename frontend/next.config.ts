import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/** Origin of the FastAPI backend, the only external host the browser may fetch from. */
function apiOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").origin;
  } catch {
    return "";
  }
}

// script-src needs 'unsafe-inline' for Next's inline bootstrap scripts and the pre-paint theme script; a nonce would
// force dynamic rendering of every page. 'wasm-unsafe-eval' is for pdf.js (not eval). unsafe-eval and ws: are dev-only.
function csp(): string {
  const api = apiOrigin();
  const d: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", ...(isProd ? [] : ["'unsafe-eval'"])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"], // avatars and attachment thumbnails
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(api ? [api] : []), ...(isProd ? [] : ["ws:", "wss:"])],
    "media-src": ["'self'", "blob:", "data:"], // read-aloud audio
    "worker-src": ["'self'", "blob:"], // pdf.js worker
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const parts = Object.entries(d).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (isProd) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp() },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // microphone is needed for dictation
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), payment=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

// per-user pages stay out of search engines and shared caches
const privateHeaders = [
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "Cache-Control", value: "private, no-store" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/s/:path*", headers: privateHeaders },
      { source: "/admin/:path*", headers: privateHeaders },
      { source: "/admin", headers: privateHeaders },
      { source: "/profile/:path*", headers: privateHeaders },
      { source: "/profile", headers: privateHeaders },
    ];
  },
};

export default nextConfig;
