/*
 * Does the sorter put things where they belong?
 *
 * The one number that matters for Capture: a capture that lands in the wrong
 * thread costs more than not sorting at all, because the person has to
 * notice it and move it. Everything else in the app is built on this being
 * right, and until now it was never measured — so "better" was an opinion.
 *
 * The ground truth comes from the board itself. Every capture recorded where
 * the engine filed it (ledger.targetId) and the fragment it created
 * (ledger.targetFragId). If that fragment now lives in a DIFFERENT thread,
 * the person moved it: the engine was wrong and the thread it sits in today
 * is the right answer. Nothing is hand-labelled; these are real decisions
 * this person actually made.
 *
 *   node scripts/eval-sort.mjs <backup.json> [--url http://localhost:4993]
 *                              [--limit N] [--concurrency N] [--out file.json]
 *
 * Prints accuracy, the confusions that cost the most, and every miss.
 */

import fs from "node:fs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

if (!file) {
  console.error("usage: node scripts/eval-sort.mjs <backup.json> [--url ...]");
  process.exit(1);
}

const URL_BASE = flag("url", "http://localhost:4993");
const LIMIT = Number(flag("limit", "0"));
const CONCURRENCY = Number(flag("concurrency", "3"));
const OUT = flag("out", null);

const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const board = raw.board ?? raw;

const names = new Map(board.threads.map((t) => [t.id, t.name]));

/* Where each fragment lives NOW — the person's own final answer. */
const homeOfFrag = new Map();
for (const t of board.threads) {
  for (const f of t.frags ?? []) homeOfFrag.set(f.id, t.id);
}

/* Threads described exactly as the app describes them to the sorter. The
   sorter is only ever as good as this context, so the eval must use the same
   one — measuring against a richer context would flatter it. */
const BRIEF_BUDGET = 5000;
const briefLimit = Math.max(
  200,
  Math.min(700, Math.floor(BRIEF_BUDGET / Math.max(board.threads.length, 1)))
);
const brief = (summary, limit = briefLimit) => {
  const text = (summary ?? "").trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "));
  return stop > limit * 0.5 ? cut.slice(0, stop + 1) : cut.trimEnd() + "…";
};
/* When each thread first existed, so a case is only ever offered the threads
   that were actually on the board at the time. Offering all of today's is
   not a harder version of the same task, it is a different one: the median
   capture in this ledger faced eleven threads, not nineteen, and scoring
   against the larger set measures a choice nobody was asked to make. */
const bornAt = new Map(
  board.threads.map((t) => [
    t.id,
    Math.min(...((t.frags ?? []).map((f) => f.at) || [0]), Infinity),
  ])
);
/* Mirrors threadBriefs exactly: the boundary first, because it is the part
   that decides, then as much summary as the budget leaves. */
const describe = (t) => ({
  id: t.id,
  name: t.name,
  about: t.belongs
    ? `${t.belongs.trim()}\n\n${brief(t.summary, Math.max(200, briefLimit - t.belongs.length))}`
    : brief(t.summary),
});
const threadsAt = (when) =>
  board.threads.filter((t) => (bornAt.get(t.id) ?? Infinity) <= when).map(describe);

/* The filing history the app sends with every sort: the last thirty
   captures and where each went. It is a strong signal — this person's own
   pattern — and leaving it out makes the sorter look worse than it is. */
const ledgerByTime = [...(board.ledger ?? [])].sort((a, b) => b.at - a.at);
function recentBefore(when) {
  return ledgerByTime
    .filter((e) => e.at < when)
    .slice(0, 30)
    .map((e) => ({
      raw: e.raw.length > 120 ? e.raw.slice(0, 120) : e.raw,
      kind: e.kind,
      at: e.at,
      target:
        e.kind === "thread" || e.kind === "both" ? names.get(e.targetId) ?? "" : "",
    }));
}

/* One case per capture whose fragment can still be traced. A capture that
   opened its own thread is left out: choosing among existing threads was not
   the task it faced, so scoring it either way says nothing. */
const cases = [];
for (const e of board.ledger ?? []) {
  if (e.undone) continue;
  if (e.kind !== "thread" && e.kind !== "both") continue;
  if (!e.targetFragId) continue;
  const expected = homeOfFrag.get(e.targetFragId);
  if (!expected) continue; // fragment deleted since
  const text = (e.raw || e.clean || "").trim();
  if (text.length < 12) continue;
  cases.push({
    id: e.id,
    /* Everything the app itself would have sent with this capture, so the
       eval measures the engine as it actually runs rather than a stripped
       version of it. */
    threads: threadsAt(e.at),
    recent: recentBefore(e.at),
    at: e.at,
    text,
    expected,
    expectedName: names.get(expected) ?? "?",
    engineChose: e.targetId,
    engineChoseName: names.get(e.targetId) ?? "(gone)",
    /* The engine was already wrong here once, and the person fixed it. These
       are the cases that must stop failing. */
    wasCorrected: expected !== e.targetId,
  });
}

const chosen = LIMIT ? cases.slice(0, LIMIT) : cases;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The provider chain rate-limits, and a run that scores only the cases which
   happened to get through is not a measurement — the survivors are the early
   ones, not a random sample, and two runs with different error rates cannot
   be compared at all. So a 429 or a 5xx waits and tries again. */
async function sortOne(c, attempt = 0) {
  const res = await fetch(`${URL_BASE}/api/sort`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: c.text, threads: c.threads, recent: c.recent }),
  });
  if (!res.ok) {
    const retriable = res.status === 429 || res.status >= 500;
    if (retriable && attempt < 5) {
      await sleep(2000 * 2 ** attempt);
      return sortOne(c, attempt + 1);
    }
    return { ...c, error: `HTTP ${res.status}` };
  }
  const out = await res.json();
  const got = out.threadId ?? null;
  return {
    ...c,
    got,
    gotName: got ? names.get(got) ?? "(new)" : out.threadName || `(${out.kind})`,
    kind: out.kind,
    via: out.via,
    correct: got === c.expected,
  };
}

async function run() {
  const avg = (
    chosen.reduce((n, c) => n + c.threads.length, 0) / (chosen.length || 1)
  ).toFixed(0);
  console.log(
    `${chosen.length} cases, ${avg} threads on the board on average ` +
      `(${chosen.filter((c) => c.wasCorrected).length} the engine got wrong before)\n`
  );
  const results = [];
  let done = 0;
  const queue = [...chosen];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const c = queue.shift();
      if (!c) return;
      try {
        results.push(await sortOne(c));
      } catch (err) {
        results.push({ ...c, error: String(err?.message || err) });
      }
      done += 1;
      if (done % 10 === 0) process.stdout.write(`  ${done}/${chosen.length}\n`);
    }
  });
  await Promise.all(workers);

  const scored = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);
  const right = scored.filter((r) => r.correct);
  const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : "—");

  console.log(`\n=== accuracy ===`);
  console.log(`  scored   : ${scored.length}${failed.length ? `  (${failed.length} errored)` : ""}`);
  console.log(`  correct  : ${right.length}  (${pct(right.length, scored.length)}%)`);
  console.log(`  wrong    : ${scored.length - right.length}  (${pct(scored.length - right.length, scored.length)}%)`);

  const previously = scored.filter((r) => r.wasCorrected);
  if (previously.length) {
    const fixed = previously.filter((r) => r.correct).length;
    console.log(
      `\n  of the ${previously.length} it got wrong before: ${fixed} now right ` +
        `(${pct(fixed, previously.length)}%)`
    );
  }

  const confusion = new Map();
  for (const r of scored.filter((r) => !r.correct)) {
    const key = `${r.gotName} -> ${r.expectedName}`;
    confusion.set(key, (confusion.get(key) ?? 0) + 1);
  }
  if (confusion.size) {
    console.log(`\n=== what it confuses (chose -> belongs) ===`);
    for (const [k, n] of [...confusion.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`  ${String(n).padStart(3)}x  ${k}`);
  }

  const byVia = new Map();
  for (const r of scored) {
    const v = byVia.get(r.via) ?? { n: 0, ok: 0 };
    v.n += 1;
    if (r.correct) v.ok += 1;
    byVia.set(r.via, v);
  }
  console.log(`\n=== by model tier ===`);
  for (const [via, v] of byVia)
    console.log(`  ${String(via).padEnd(12)} ${v.ok}/${v.n}  (${pct(v.ok, v.n)}%)`);

  console.log(`\n=== every miss ===`);
  for (const r of scored.filter((r) => !r.correct)) {
    console.log(`\n  chose ${r.gotName}  |  belongs ${r.expectedName}`);
    console.log(`    ${r.text.replace(/\s+/g, " ").slice(0, 150)}`);
  }

  if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify({ results }, null, 2));
    console.log(`\nwrote ${OUT}`);
  }

  const rate = scored.length ? (scored.length - right.length) / scored.length : 1;
  console.log(`\nmiss rate: ${(rate * 100).toFixed(1)}%`);
}

run();
