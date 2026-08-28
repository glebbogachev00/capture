/*
 * The same routing question, asked of a stronger model.
 *
 * The free-tier chain (Groq → Mistral → Gemini) misses roughly a quarter of
 * the time, and prompt work has stopped moving that number: raising the bar
 * for new threads cut invented threads by a third and left the total
 * unchanged, and giving each thread a written boundary made it very slightly
 * worse. Before building anything else, it is worth knowing which kind of
 * problem this is.
 *
 * If a strong model scores far better on these exact cases, the ceiling is
 * model capability, and the answer is to route sorting somewhere better. If
 * it scores about the same, the ceiling is the task as posed — the threads
 * genuinely overlap, or the ground truth is noisier than it looks — and no
 * amount of model will fix it.
 *
 * This runs against the local `claude` CLI, on this machine, under the
 * person's own subscription. It is a measurement harness, not a product
 * path: the app cannot call a CLI on someone's laptop.
 *
 *   node scripts/eval-sort-claude.mjs <board.json> [--limit N] [--out f.json]
 */

import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const LIMIT = Number(flag("limit", "0"));
const OUT = flag("out", null);
const MODEL = flag("model", "sonnet");

const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const board = raw.board ?? raw;
const names = new Map(board.threads.map((t) => [t.id, t.name]));

const homeOfFrag = new Map();
for (const t of board.threads)
  for (const f of t.frags ?? []) homeOfFrag.set(f.id, t.id);

const bornAt = new Map(
  board.threads.map((t) => [
    t.id,
    Math.min(...((t.frags ?? []).map((f) => f.at) || [0]), Infinity),
  ])
);

const briefLimit = Math.max(
  200,
  Math.min(700, Math.floor(5000 / Math.max(board.threads.length, 1)))
);
const brief = (s) => {
  const text = (s ?? "").trim();
  return text.length <= briefLimit ? text : text.slice(0, briefLimit) + "…";
};

const cases = [];
for (const e of board.ledger ?? []) {
  if (e.undone || (e.kind !== "thread" && e.kind !== "both")) continue;
  if (!e.targetFragId) continue;
  const expected = homeOfFrag.get(e.targetFragId);
  if (!expected) continue;
  const text = (e.raw || e.clean || "").trim();
  if (text.length < 12) continue;
  const threads = board.threads
    .filter((t) => (bornAt.get(t.id) ?? Infinity) <= e.at)
    .map((t) => ({ id: t.id, name: t.name, about: brief(t.summary) }));
  if (!threads.some((t) => t.id === expected)) continue;
  cases.push({
    id: e.id,
    text,
    threads,
    expected,
    expectedName: names.get(expected) ?? "?",
    wasCorrected: expected !== e.targetId,
  });
}

const chosen = LIMIT ? cases.slice(0, LIMIT) : cases;

const RULES = `You are the filing engine for a personal capture app. A person said one thing out loud. Decide which of their existing threads it belongs in.

Rules:
- Choose by SUBJECT, not by shared words. A capture that merely uses a word from a thread's name does not belong there.
- Prefer an existing thread. Only answer "new" when no existing thread is about this subject — a new thread splits a subject the person already keeps in one place, and becomes a decoy for later captures.
- Same subject in different words still belongs in the same thread.

Answer with ONLY a JSON object: {"threadId":"<id>"} or {"threadId":null} if genuinely none fit. No prose.`;

function prompt(c) {
  return (
    RULES +
    "\n\nTheir threads:\n" +
    c.threads
      .map((t) => `- id=${t.id} | ${t.name}\n    ${t.about.replace(/\s+/g, " ").slice(0, 400)}`)
      .join("\n") +
    `\n\nWhat they said:\n"${c.text.replace(/\s+/g, " ")}"\n\nJSON:`
  );
}

async function ask(c) {
  const { stdout } = await run(
    "claude",
    ["-p", prompt(c), "--model", MODEL, "--output-format", "json"],
    { maxBuffer: 8 * 1024 * 1024, timeout: 120000 }
  );
  const envelope = JSON.parse(stdout);
  const body = String(envelope.result ?? "");
  const m = body.match(/\{[\s\S]*?\}/);
  if (!m) throw new Error("no json in reply");
  const got = JSON.parse(m[0]).threadId ?? null;
  return {
    ...c,
    got,
    gotName: got ? names.get(got) ?? "(unknown id)" : "(new)",
    correct: got === c.expected,
  };
}

const results = [];
let done = 0;
for (const c of chosen) {
  try {
    results.push(await ask(c));
  } catch (err) {
    results.push({ ...c, error: String(err?.message || err).slice(0, 80) });
  }
  done += 1;
  if (done % 10 === 0) process.stdout.write(`  ${done}/${chosen.length}\n`);
}

const scored = results.filter((r) => !r.error);
const right = scored.filter((r) => r.correct);
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : "—");

console.log(`\n=== ${MODEL} ===`);
console.log(`  scored  : ${scored.length}  (${results.length - scored.length} errored)`);
console.log(`  correct : ${right.length}  (${pct(right.length, scored.length)}%)`);
console.log(`  wrong   : ${scored.length - right.length}  (${pct(scored.length - right.length, scored.length)}%)`);

const prev = scored.filter((r) => r.wasCorrected);
if (prev.length)
  console.log(
    `  of the ${prev.length} the engine got wrong before: ${prev.filter((r) => r.correct).length} right`
  );

const confusion = new Map();
for (const r of scored.filter((r) => !r.correct)) {
  const k = `${r.gotName} -> ${r.expectedName}`;
  confusion.set(k, (confusion.get(k) ?? 0) + 1);
}
console.log(`\n=== what it confuses ===`);
for (const [k, n] of [...confusion].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(n).padStart(3)}x  ${k}`);

if (OUT) fs.writeFileSync(OUT, JSON.stringify({ results }, null, 2));
console.log(`\nmiss rate: ${pct(scored.length - right.length, scored.length)}%`);
