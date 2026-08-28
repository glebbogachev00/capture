/*
 * Give every thread its routing boundary.
 *
 * A thread's "what belongs here" line is written by the summariser, so a
 * board summarised before boundaries existed has none and routes exactly as
 * it did before. This asks for one per thread, with the sibling names in
 * view so each can name its edges, and writes an augmented copy of the board.
 *
 *   node scripts/backfill-belongs.mjs <board.json> <out.json> [--url ...]
 *
 * It never writes over its input.
 */

import fs from "node:fs";

const args = process.argv.slice(2);
const [file, out] = args.filter((a) => !a.startsWith("--"));
const i = args.indexOf("--url");
const URL_BASE = i === -1 ? "http://localhost:4994" : args[i + 1];

if (!file || !out) {
  console.error("usage: node scripts/backfill-belongs.mjs <board.json> <out.json>");
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const board = raw.board ?? raw;
const allNames = board.threads.map((t) => t.name);

async function belongsFor(thread) {
  const res = await fetch(`${URL_BASE}/api/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: thread.name,
      frags: (thread.frags ?? []).map((f) => ({ at: f.at, text: f.text })),
      siblings: allNames.filter((n) => n !== thread.name),
    }),
  });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const body = await res.json();
  return { belongs: body.belongs ?? null, via: body.via };
}

const withFrags = board.threads.filter((t) => (t.frags ?? []).length);
console.log(`${withFrags.length} threads with fragments\n`);

let got = 0;
for (const t of withFrags) {
  try {
    const { belongs, via, error } = await belongsFor(t);
    if (error) {
      console.log(`  ${t.name.padEnd(34)} ${error}`);
      continue;
    }
    if (!belongs) {
      console.log(`  ${t.name.padEnd(34)} (no line returned, via ${via})`);
      continue;
    }
    t.belongs = belongs;
    got += 1;
    console.log(`  ${t.name.padEnd(34)} ${belongs.slice(0, 90)}`);
  } catch (err) {
    console.log(`  ${t.name.padEnd(34)} ${String(err?.message || err)}`);
  }
}

fs.writeFileSync(out, JSON.stringify(raw.board ? { ...raw, board } : board, null, 2));
console.log(`\n${got}/${withFrags.length} threads have a boundary — wrote ${out}`);
