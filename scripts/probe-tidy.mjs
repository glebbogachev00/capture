#!/usr/bin/env node
/**
 * Probe: does the model-driven Tidy pass (specs/capture-tidy-connect-prompt.md
 * rev 3) find the same IDEA in different words — and obey the product rule?
 *
 * Drives the REAL /api/organize endpoint — the actual prompt, the actual
 * provider chain, the actual id validation — with a seeded board built around
 * the case word-matching can never catch: "I keep meaning to dial back the
 * evening caffeine" (in "Morning routine") and "cutting the 4pm espresso"
 * (in "Coffee habits") share no content words, so the deterministic scan
 * proposes nothing. The model must see that they are one thought.
 *
 * The same board also carries a genuine duplicate (word-matching WOULD catch
 * it), a note that reads as a task (extract_action), and a clearly separate
 * thread that must NOT be dragged into any proposal.
 *
 * Pass criteria (from the spec):
 *   - the semantic case is caught: a merge_fragments (or a fragment move
 *     onto the caffeine thread) proposing the espresso note join the
 *     morning-routine thread
 *   - NO whole-thread merges — no proposal of kind merge_threads
 *   - no hallucinated ids: every id in the response exists in the seed
 *   - ≤ 12 high + 8 medium proposals
 *
 * Usage:  node scripts/probe-tidy.mjs [base-url]
 *   base-url defaults to http://localhost:3000. The dev server must be up
 *   (npm run dev) and .env.local must hold the provider keys.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ENV_LOCAL = fileURLToPath(new URL("../.env.local", import.meta.url));
const COOKIE_CACHE = fileURLToPath(new URL("../.freebuff/probe-cookie.txt", import.meta.url));
const BASE = process.argv[2] || "http://localhost:3000";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function appPassword() {
  if (process.env.APP_PASSWORD) return process.env.APP_PASSWORD;
  try {
    const raw = fs.readFileSync(ENV_LOCAL, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^APP_PASSWORD=(.*)$/);
      if (m) {
        let v = m[1].trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        )
          v = v.slice(1, -1);
        return v;
      }
    }
  } catch {
    /* no .env.local — the gate is off */
  }
  return null;
}

async function sessionCookie() {
  const pw = appPassword();
  if (!pw) return null;
  let cached = "";
  try {
    cached = fs.readFileSync(COOKIE_CACHE, "utf8").trim();
  } catch {}
  if (cached) return cached;
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: pw }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`login ${res.status}: ${body.error || res.statusText}`);
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("login succeeded but no session cookie returned");
  const cookie = setCookie.split(";")[0];
  fs.mkdirSync(fileURLToPath(new URL("../.freebuff", import.meta.url)), { recursive: true });
  fs.writeFileSync(COOKIE_CACHE, cookie);
  return cookie;
}

/* The seeded board. The semantic case is the espresso/caffeine pair — the
   deterministic scan finds NO shared content words between them, so a pass
   that only word-matches proposes nothing here. */
const SEED = {
  actions: [
    { id: "a1", text: "Book a dentist appointment for Tuesday", at: 300 },
    { id: "a2", text: "Book a dentist appointment for Friday", at: 100 }, // genuine dup, word-matching catches this one
    { id: "a3", text: "Buy oat milk", at: 200 },
  ],
  threads: [
    {
      id: "t-morning",
      name: "Morning routine",
      summary: "Waking up and feeling good",
      frags: [
        { id: "f1", text: "I keep meaning to dial back the evening caffeine", at: 150 },
        { id: "f2", text: "Wake at 6 and actually feel rested", at: 100 },
      ],
    },
    {
      id: "t-coffee",
      name: "Coffee habits",
      summary: "",
      frags: [
        { id: "f3", text: "Cutting the 4pm espresso has been the plan for a while", at: 140 },
        { id: "f4", text: "I need to renew the coffee subscription this month", at: 120 }, // reads as a task
      ],
    },
    {
      id: "t-career",
      name: "Career",
      summary: "",
      frags: [{ id: "f5", text: "Portfolio review went well", at: 90 }],
    },
  ],
  intentions: [
    { id: "i1", expanded: "I live somewhere with light and space to think" },
  ],
};

async function review() {
  const headers = { "Content-Type": "application/json" };
  const cookie = await sessionCookie();
  if (cookie) headers.Cookie = cookie;
  let res = await fetch(`${BASE}/api/organize`, {
    method: "POST",
    headers,
    body: JSON.stringify(SEED),
  });
  if (res.status === 429) {
    const retry = Number(res.headers.get("Retry-After") || 5);
    console.log(`  429 — waiting ${retry}s…`);
    await sleep(retry * 1000);
    res = await fetch(`${BASE}/api/organize`, {
      method: "POST",
      headers,
      body: JSON.stringify(SEED),
    });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`organize ${res.status}: ${body.error || res.statusText}`);
  }
  return res.json();
}

/* Every id in the response must exist in the seed. */
const KNOWN = new Set([
  ...SEED.actions.map((a) => a.id),
  ...SEED.threads.map((t) => t.id),
  ...SEED.threads.flatMap((t) => t.frags.map((f) => f.id)),
  ...SEED.intentions.map((i) => i.id),
]);

async function main() {
  console.log(`Probing ${BASE}/api/organize — the real chain.`);
  const out = await review();
  const proposals = out.proposals || [];
  const via = out.via || "-";

  console.log(`via ${via} · ${proposals.length} proposal(s):\n`);
  for (const p of proposals) {
    console.log(
      `  [${p.confidence}] ${p.kind}  ${p.sourceFragId ? "frag " + p.sourceFragId + " → " : ""}${p.sourceId} → ${p.targetId}`
    );
    console.log(`      "${p.reason}"`);
  }

  const semanticCaught = proposals.some(
    (p) =>
      (p.kind === "merge_fragments" || p.kind === "move_fragment") &&
      (p.targetId === "t-morning" || p.sourceId === "t-morning")
  );
  const noThreadMerges = proposals.every((p) => p.kind !== "merge_threads");
  const noHallucinated = proposals.every(
    (p) =>
      KNOWN.has(p.sourceId) &&
      KNOWN.has(p.targetId) &&
      (!p.sourceFragId || KNOWN.has(p.sourceFragId))
  );
  const withinCap =
    proposals.filter((p) => p.confidence === "high").length <= 12 &&
    proposals.filter((p) => p.confidence === "medium").length <= 8;
  const careerUntouched = !proposals.some((p) => p.sourceId === "t-career" || p.targetId === "t-career");

  const passes = [
    ["semantic case caught (espresso note joins the morning-routine thread)", semanticCaught],
    ["no whole-thread merges (product rule)", noThreadMerges],
    ["no hallucinated ids", noHallucinated],
    ["within caps (12 high + 8 medium)", withinCap],
    ["unrelated career thread untouched", careerUntouched],
  ];

  console.log("\n════════════════════════════════════");
  let all = true;
  for (const [label, ok] of passes) {
    if (!ok) all = false;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  }
  console.log(
    all
      ? "\nOverall: PASS — the model sees the same idea in different words and obeys the product rule."
      : "\nOverall: FAIL — see the failing rows above."
  );
  process.exit(all ? 0 : 1);
}

main().catch((e) => {
  console.error(`\nProbe failed: ${e.message}`);
  console.error("Is the dev server running? (npm run dev, then retry.)");
  process.exit(1);
});
