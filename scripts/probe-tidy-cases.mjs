#!/usr/bin/env node
/**
 * Probe: the FIVE Tidy use cases, live against the real chain.
 *
 * Drives /api/organize (the actual prompt, provider chain, and id
 * validation) once per board in src/lib/tidyCases.json — the same boards
 * the deterministic unit tests (src/lib/tidyCases.test.ts) pin down
 * offline. This script answers the questions a unit test can't: does the
 * MODEL behave — does it see the same idea in different words, extract
 * only real tasks, avoid inventing junk on a clean board — and do its
 * reasons sound right?
 *
 * Each case carries expectations from the JSON:
 *   aiExpect — kinds the model MUST propose (hard), except those in `soft`
 *   aiForbid — kinds that must NEVER appear
 *   silence  — the board is clean: zero proposals, or the case fails
 *
 * Usage:  node scripts/probe-tidy-cases.mjs [base-url]
 *   base-url defaults to http://localhost:3000. The dev server must be up
 *   (npm run dev) and .env.local must hold the provider keys.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ENV_LOCAL = fileURLToPath(new URL("../.env.local", import.meta.url));
const COOKIE_CACHE = fileURLToPath(new URL("../.freebuff/probe-cookie.txt", import.meta.url));
const CASES_JSON = fileURLToPath(new URL("../src/lib/tidyCases.json", import.meta.url));
const BASE = process.argv[2] || "http://localhost:3000";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CASES = JSON.parse(fs.readFileSync(CASES_JSON, "utf8"));

/* A typo'd kind in the expectations would make a forbidden kind pass
   vacuously (it is never found) — validate every kind string up front. */
const ENGINE_KINDS = new Set([
  "merge_fragments",
  "dup_action",
  "dup_fragment",
  "fold_action",
  "move_fragment",
  "extract_action",
]);
/* aiForbid may also carry merge_threads — the product rule: the engine can
   never emit it, but forbidding it guards against re-introduction. */
const FORBID_KINDS = new Set([...ENGINE_KINDS, "merge_threads"]);
for (const tc of CASES) {
  for (const k of [...tc.localExpect, ...tc.aiExpect, ...tc.soft]) {
    if (!ENGINE_KINDS.has(k))
      throw new Error(`${tc.id}: unknown expected kind "${k}"`);
  }
  for (const k of tc.aiForbid) {
    if (!FORBID_KINDS.has(k))
      throw new Error(`${tc.id}: unknown forbidden kind "${k}"`);
  }
  for (const p of tc.cannedAi) {
    if (!ENGINE_KINDS.has(p.kind))
      throw new Error(`${tc.id}: unknown canned kind "${p.kind}"`);
  }
}

function appPassword() {
  if (process.env.APP_PASSWORD) return process.env.APP_PASSWORD;
  try {
    const raw = fs.readFileSync(ENV_LOCAL, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^APP_PASSWORD=(.*)$/);
      if (m) {
        let v = m[1].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
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
    /* The server runs with APP_PASSWORD unset (a fresh clone, or a local
       test instance): the gate is off, so no cookie is needed at all. */
    if (res.status === 400 && /not configured/i.test(body.error || ""))
      return null;
    throw new Error(`login ${res.status}: ${body.error || res.statusText}`);
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("login succeeded but no session cookie returned");
  const cookie = setCookie.split(";")[0];
  fs.mkdirSync(fileURLToPath(new URL("../.freebuff", import.meta.url)), { recursive: true });
  fs.writeFileSync(COOKIE_CACHE, cookie);
  return cookie;
}

async function review(board) {
  const headers = { "Content-Type": "application/json" };
  const cookie = await sessionCookie();
  if (cookie) headers.Cookie = cookie;
  let res = await fetch(`${BASE}/api/organize`, {
    method: "POST",
    headers,
    body: JSON.stringify(board),
  });
  if (res.status === 429) {
    const retry = Number(res.headers.get("Retry-After") || 5);
    console.log(`    rate-limited — waiting ${retry}s…`);
    await sleep(retry * 1000);
    res = await fetch(`${BASE}/api/organize`, {
      method: "POST",
      headers,
      body: JSON.stringify(board),
    });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`organize ${res.status}: ${body.error || res.statusText}`);
  }
  return res.json();
}

/* ---- human-readable board summary so the report is self-contained ---- */

function summarize(board) {
  const lines = [];
  if (board.actions.length)
    lines.push(`actions: ${board.actions.map((a) => `[${a.id}] ${a.text}`).join(" | ")}`);
  for (const t of board.threads) {
    lines.push(`thread [${t.id}] "${t.name}": ${t.frags.map((f) => `[${f.id}] ${f.text}`).join(" | ")}`);
  }
  if (board.intentions.length)
    lines.push(`intention: ${board.intentions.map((i) => `[${i.id}] ${i.expanded}`).join(" | ")}`);
  return lines.join("\n    ");
}

/* ---- per-case assertions ---- */

function checkCase(tc, proposals) {
  const results = [];
  const known = new Set([
    ...tc.board.actions.map((a) => a.id),
    ...tc.board.threads.map((t) => t.id),
    ...tc.board.threads.flatMap((t) => t.frags.map((f) => f.id)),
    ...tc.board.intentions.map((i) => i.id),
  ]);
  const kinds = proposals.map((p) => p.kind);

  results.push([
    "no whole-thread merges (product rule)",
    kinds.every((k) => k !== "merge_threads"),
    "fatal",
  ]);
  results.push([
    "no hallucinated ids — every id exists in the board",
    proposals.every(
      (p) =>
        known.has(p.sourceId) && known.has(p.targetId) && (!p.sourceFragId || known.has(p.sourceFragId))
    ),
    "fatal",
  ]);
  results.push([
    `reasons read like sentences, not labels (no "keywords")`,
    proposals.every(
      (p) =>
        p.reason.length >= (p.confidence === "high" ? 15 : 10) &&
        !/keyword|similar word/i.test(p.reason)
    ),
    "fatal",
  ]);

  for (const kind of tc.aiExpect) {
    const severity = tc.soft.includes(kind) ? "warn" : "fatal";
    results.push([`proposes ${kind}`, kinds.includes(kind), severity]);
  }
  for (const kind of tc.aiForbid) {
    results.push([`never proposes ${kind}`, !kinds.includes(kind), "fatal"]);
  }
  if (tc.silence) {
    results.push([
      "proposes NOTHING on a clean board (silence is correct)",
      proposals.length === 0,
      "fatal",
    ]);
  }

  /* Duplicates must name the newer capture as the copy, like the local
     scan. (Belt-and-suspenders: the server already normalises direction in
     mapAiProposals, so this can never fail live — it exists so a future
     change that breaks the invariant surfaces here too.) */
  const dup = proposals.find((p) => p.kind === "dup_action");
  if (dup) {
    const src = tc.board.actions.find((a) => a.id === dup.sourceId);
    const tgt = tc.board.actions.find((a) => a.id === dup.targetId);
    results.push([
      "duplicate names the NEWER capture as the copy",
      !!(src && tgt && src.at > tgt.at),
      "fatal",
    ]);
  }

  return results;
}

/* ---- main ---- */

async function main() {
  const all = [];
  console.log(`Tidy use-case probe — ${BASE}/api/organize (real chain, 5 boards)\n`);

  for (const tc of CASES) {
    console.log(`════════════════════════════════════════════════════════`);
    console.log(`CASE  ${tc.id} — ${tc.name}`);
    console.log(`      ${tc.blurb}`);
    console.log(`\n    board:\n    ${summarize(tc.board)}`);

    const out = await review(tc.board);
    const proposals = out.proposals || [];
    console.log(`\n    model proposals (via ${out.via || "-"}): ${proposals.length}`);

    if (proposals.length === 0) {
      console.log("      (none — the model stayed silent)");
    }
    for (const p of proposals) {
      const where =
        p.kind === "extract_action"
          ? `${p.sourceThreadId ? `[${p.sourceThreadId}] ` : ""}[${p.sourceFragId}] → an action`
          : p.sourceFragId
            ? `[${p.sourceThreadId}] [${p.sourceFragId}] → [${p.targetId}]`
            : `[${p.sourceId}] → [${p.targetId}]`;
      console.log(`      [${p.confidence}] ${p.kind}  ${where}`);
      console.log(`          “${p.reason}”`);
    }

    const results = checkCase(tc, proposals);
    const fatal = results.filter(([, ok, sev]) => !ok && sev === "fatal");
    const warns = results.filter(([, ok, sev]) => !ok && sev === "warn");
    const ok = results.filter(([, ok]) => ok);
    const pass = fatal.length === 0;

    console.log(`\n    verdict: ${pass ? "PASS" : "FAIL"}  (${ok.length} ✓ / ${warns.length} ⚠ / ${fatal.length} ✗)`);
    for (const [label, good, sev] of results) {
      if (!good) console.log(`      ${sev === "warn" ? "⚠ WARN " : "✗ FAIL "} ${label}`);
    }
    all.push({ id: tc.id, pass, fatal: fatal.length, warns: warns.length });
  }

  console.log(`\n════════════════════════════════════════════════════════`);
  console.log("SUMMARY");
  let failures = 0;
  for (const r of all) {
    if (!r.pass) failures++;
    console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.id}  (${r.fatal} fatal${r.warns ? `, ${r.warns} warn` : ""})`);
  }
  const allGood = failures === 0;
  console.log(
    allGood
      ? "\nOverall: PASS — the model is logically correct, sounds right, and only proposes changes that tidy the board."
      : `\nOverall: FAIL — ${failures} case(s) failed; read the failing rows above.`
  );
  process.exit(allGood ? 0 : 1);
}

main().catch((e) => {
  console.error(`\nProbe failed: ${e.message}`);
  console.error("Is the dev server running? (npm run dev, then retry.)");
  process.exit(1);
});
