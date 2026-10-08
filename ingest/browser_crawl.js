/*
 * AskUoC in-browser page collector. The site's JS challenge blocks plain HTTP clients, so this runs in
 * your own Chrome tab on cyberjaya.edu.my. It fetches sitemap URLs slowly and stops on a challenge/CAPTCHA.
 *
 * Usage: open https://cyberjaya.edu.my/, paste this file into the DevTools console, allow multiple downloads.
 * Move the downloaded uoc_pages_*.json to data/browser/ and run `python -m ingest.import_browser`.
 * Console controls: uocStop() pauses, uocRun() resumes, uocReset() clears progress.
 */
(() => {
  const CFG = {
    // most useful content first, so a partial run is still useful
    types: ["page", "programme", "funding", "testimonials", "post", "tribe_events"],
    recentMonths: 12,        // posts/events: only items modified within this many months
    delayMs: [6000, 9000],   // random delay between requests; 2-3s tripped the WAF
    batchSize: 25,           // pages per downloaded file
    maxChallenges: 2,        // abort after this many challenge/blocked responses
    cooldownMs: 300000,      // wait 5 min after a challenge before retrying that URL
    stateKey: "askuoc_done_v1",
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = () => CFG.delayMs[0] + Math.random() * (CFG.delayMs[1] - CFG.delayMs[0]);
  const done = new Set(JSON.parse(localStorage.getItem(CFG.stateKey) || "[]"));
  const saveState = () => localStorage.setItem(CFG.stateKey, JSON.stringify([...done]));
  let stopped = false;
  let fileNo = Number(localStorage.getItem(CFG.stateKey + "_file") || 0);

  const isChallenge = (text) =>
    /You are being redirected|sucuri_cloudproxy|Javascript is required|Access Denied|captcha/i.test(text.slice(0, 4000)) &&
    text.length < 20000;

  function locs(xml) {
    const out = [];
    for (const m of xml.matchAll(/<(?:url|sitemap)>([\s\S]*?)<\/(?:url|sitemap)>/g)) {
      const loc = /<loc>([^<]+)<\/loc>/.exec(m[1]);
      const mod = /<lastmod>([^<]+)<\/lastmod>/.exec(m[1]);
      if (loc) out.push({ loc: loc[1].trim(), lastmod: mod ? mod[1].trim() : null });
    }
    return out;
  }

  async function getText(url, tries = 4) {
    for (let n = 1; n <= tries; n++) {
      try {
        const r = await fetch(url, { credentials: "include" });
        const t = await r.text();
        if (r.ok && !isChallenge(t)) return t;
        console.warn(`${url}: HTTP ${r.status}${isChallenge(t) ? " (challenge)" : ""} — attempt ${n}/${tries}`);
      } catch (e) {
        console.warn(`${url}: ${e.message} — attempt ${n}/${tries}`);
      }
      await sleep(5000 * n);
    }
    throw new Error(`Could not load ${url}. Site unreachable/blocked from this network; wait and try again later.`);
  }

  async function discover() {
    const idx = await getText("/sitemap_index.xml");
    const items = new Map();
    for (const type of CFG.types) {
      for (const sm of locs(idx)) {
        const m = /\/([a-z_]+?)-sitemap\d*\.xml$/.exec(sm.loc);
        if (!m || m[1] !== type) continue;
        await sleep(400);
        const xml = await getText(sm.loc);
        const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - CFG.recentMonths);
        for (const u of locs(xml)) {
          if ((type === "post" || type === "tribe_events") && (!u.lastmod || new Date(u.lastmod) < cutoff)) continue;
          if (!items.has(u.loc)) items.set(u.loc, { url: u.loc, doc_type: type, lastmod: u.lastmod });
        }
      }
    }
    return [...items.values()];
  }

  // keep classes: the Python extractor uses them to find accordions/FAQs
  function slim(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script,style,noscript,svg,iframe,link[rel=stylesheet],template").forEach((n) => n.remove());
    doc.querySelectorAll("[style]").forEach((n) => n.removeAttribute("style"));
    doc.querySelectorAll("img").forEach((n) => {
      const s = n.getAttribute("src") || "";
      if (s.startsWith("data:")) n.removeAttribute("src");
    });
    return "<!doctype html>" + doc.documentElement.outerHTML;
  }

  function download(name, obj) {
    const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  async function run() {
    stopped = false;
    if (location.hostname !== "cyberjaya.edu.my") {
      console.error("Open https://cyberjaya.edu.my/ (no www) first, then paste the script there.");
      return;
    }
    console.log("Discovering URLs from sitemaps…");
    let all;
    try {
      all = await discover();
    } catch (e) {
      console.error(e.message);
      return;
    }
    const todo = all.filter((i) => !done.has(i.url));
    console.log(`${all.length} URLs total, ${todo.length} to fetch, ~${Math.round((todo.length * 7.5) / 60)} min`);

    let batch = [];
    let challenges = 0;
    const flush = () => {
      if (!batch.length) return;
      fileNo += 1;
      localStorage.setItem(CFG.stateKey + "_file", String(fileNo));
      download(`uoc_pages_${String(fileNo).padStart(3, "0")}.json`, batch);
      batch.forEach((b) => done.add(b.url));
      saveState();
      batch = [];
    };

    for (let i = 0; i < todo.length; i++) {
      if (stopped) {
        console.log("Paused.");
        flush();
        return;
      }
      const item = todo[i];
      try {
        const r = await fetch(item.url, { credentials: "include", redirect: "follow" });
        const text = await r.text();
        if (r.status === 429 || r.status === 403 || isChallenge(text)) {
          challenges += 1;
          console.warn(`Blocked/challenged (${r.status}) at ${item.url} [${challenges}/${CFG.maxChallenges}]`);
          if (challenges >= CFG.maxChallenges) {
            console.error("Too many blocks — stopping. Reload the site in a normal tab, wait a while, then uocRun().");
            flush();
            return;
          }
          console.warn("cooling down 5 min…");
          await sleep(CFG.cooldownMs);
          i -= 1; // retry same URL after cool-down
          continue;
        }
        if (r.ok && (r.headers.get("content-type") || "").includes("html")) {
          batch.push({ ...item, final_url: r.url, html: slim(text) });
          console.log(`[${done.size + batch.length}/${all.length}] ok ${item.url}`);
        } else {
          console.log(`skip ${r.status} ${item.url}`);
          done.add(item.url);
        }
      } catch (e) {
        console.warn("fetch error", item.url, e.message);
      }
      if (batch.length >= CFG.batchSize) {
        flush();
        console.log(`%c saved file ${fileNo} — total ${done.size}/${all.length}`, "color: green; font-weight: bold");
      }
      await sleep(jitter());
    }
    flush();
    console.log(`DONE — ${done.size} pages. Move uoc_pages_*.json to AskUoC/data/browser/`);
  }

  window.uocRun = run;
  window.uocStop = () => (stopped = true);
  window.uocReset = () => {
    localStorage.removeItem(CFG.stateKey);
    localStorage.removeItem(CFG.stateKey + "_file");
    done.clear();
    fileNo = 0;
    console.log("progress reset");
  };
  run();
})();
