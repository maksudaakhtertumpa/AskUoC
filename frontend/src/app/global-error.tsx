"use client";

import { useEffect } from "react";

/** Last-resort boundary: replaces the root layout, so it brings its own <html>/<body> and inline styles. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const css = `
    :root{color-scheme:light dark;--bg:#f6f0fb;--card:#ffffffd9;--fg:#170c26;--muted:#4d3175;--line:#dccdf1}
    @media (prefers-color-scheme:dark){:root{--bg:#170c26;--card:#1e1132e6;--fg:#f7f3fc;--muted:#c2a8e5;--line:#ffffff1f}}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
    main{width:100%;max-width:26rem;padding:32px 28px;text-align:center;background:var(--card);border:1px solid var(--line);border-radius:24px;box-shadow:0 24px 60px -24px #2b1b4280}
    .mark{width:56px;height:56px;margin:0 auto 18px;border-radius:16px;background:linear-gradient(135deg,#603e90,#d33d8f);color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700}
    h1{margin:0 0 8px;font-size:1.5rem;letter-spacing:-.01em}
    p{margin:0;color:var(--muted);font-size:.95rem;line-height:1.5}
    .row{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:24px}
    button,a.btn{min-height:44px;padding:0 24px;border-radius:999px;font:inherit;font-size:.9rem;font-weight:500;display:inline-flex;align-items:center;justify-content:center;text-decoration:none;cursor:pointer}
    button{border:0;color:#fff;background:linear-gradient(90deg,#603e90,#d33d8f)}
    a.btn{color:var(--fg);border:1px solid var(--line);background:transparent}
    button:focus-visible,a.btn:focus-visible{outline:3px solid #d33d8f;outline-offset:2px}
    small{display:block;margin-top:22px;font-size:.7rem;color:var(--muted)}
  `;

  return (
    <html lang="en">
      <head>
        <title>Something went wrong · AskUoC</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{css}</style>
      </head>
      <body>
        <main role="alert">
          <div className="mark" aria-hidden="true">
            !
          </div>
          <h1>Something went wrong</h1>
          <p>AskUoC hit an unexpected problem and could not display this page. Trying again often fixes it.</p>
          <div className="row">
            <button type="button" onClick={() => retry()}>
              Try again
            </button>
            {/* plain anchor on purpose: a full reload recovers from a broken app shell */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a className="btn" href="/">
              Back to chat
            </a>
          </div>
          {error.digest && <small>Error reference: {error.digest}</small>}
        </main>
      </body>
    </html>
  );
}
