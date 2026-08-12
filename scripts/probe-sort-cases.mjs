#!/usr/bin/env node
/**
 * Probe: the sort engine's known failure modes, live against the real chain.
 *
 * Drives /api/sort (the actual prompt, provider chain, and reconciliation)
 * once per case in src/lib/sortCases.json. The offline test
 * (src/lib/sortCases.test.ts) keeps the suite well-formed; this script
 * answers what a unit test can't: does the MODEL sort right — does a
 * want-phrased errand stay an action, does a complaint stay uninvented,
 * does a continuing subject route into its thread?
 *
 * Expectations per case (all optional except kindOneOf):
 *   kindOneOf      the returned kind must be one of these
 *   actionsBetween [lo, hi] bounds on actions.length
 *   actionsMention every word listed must appear in some action (case-insensitive)
 *   noActions      actions must be empty
 *   routeTo        threadId must equal this id
 *   newThread      threadId null AND a threadName invented
 *   shelfIn        shelfLife must be one of these
 *
 * Usage:  node scripts/probe-sort-cases.mjs [base-url]
 *   base-url defaults to http://localhost:3000. The server must be up and
 *   .env.local must hold the provider keys. Every case spends real quota.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ENV_LOCAL = fileURLToPath(new URL("../.env.local", import.meta.url));
const COOKIE_CACHE = fileURLToPath(
  new URL("../.freebuff/probe-cookie.txt", import.meta.url)
);
const CASES_JSON = fileURLToPath(
  new URL("../src/lib/sortCases.json", import.meta.url)
);
const BASE = process.argv[2] || "http://localhost:3000";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CASES = JSON.parse(fs.readFileSync(CASES_JSON, "utf8"));

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
  if (!setCookie)
    throw new Error("login succeeded but no session cookie returned");
  const cookie = setCookie.split(";")[0];
  fs.mkdirSync(fileURLToPath(new URL("../.freebuff", import.meta.url)), {
    recursive: true,
  });
  fs.writeFileSync(COOKIE_CACHE, cookie);
  return cookie;
}

async function sortOnce(raw, threads) {
  const headers = { "Content-Type": "application/json" };
  const cookie = await sessionCookie();
  if (cookie) headers.Cookie = cookie;
  let res = await fetch(`${BASE}/api/sort`, {
    method: "POST",
    headers,
    body: JSON.stringify({ raw, threads }),
  });
  if (res.status === 401 && cookie) {
    /* A cached cookie from the other mode (dev and prod use different
       cookie names) or an expired one — drop it and log in fresh. */
    try {
      fs.unlinkSync(COOKIE_CACHE);
    } catch {}
    const fresh = await sessionCookie();
    if (fresh) headers.Cookie = fresh;
    res = await fetch(`${BASE}/api/sort`, {
      method: "POST",
      headers,
      body: JSON.stringify({ raw, threads }),
    });
  }
  if (res.status === 429) {
    const retry = Number(res.headers.get("Retry-After") || 5);
    console.log(`    rate-limited — waiting ${retry}s…`);
    await sleep(retry * 1000);
    res = await fetch(`${BASE}/api/sort`, {
      method: "POST",
      headers,
      body: JSON.stringify({ raw, threads }),
    });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`sort ${res.status}: ${body.error || res.statusText}`);
  }
  return res.json();
}

function judge(tc, out) {
  const e = tc.expect;
  const problems = [];
  const acts = out.actions || [];
  if (!e.kindOneOf.includes(out.kind))
    problems.push(`kind "${out.kind}" not in [${e.kindOneOf}]`);
  if (e.noActions && acts.length)
    problems.push(`invented ${acts.length} action(s): ${JSON.stringify(acts)}`);
  if (e.actionsBetween) {
    const [lo, hi] = e.actionsBetween;
    if (acts.length < lo || acts.length > hi)
      problems.push(`${acts.length} actions, wanted ${lo}–${hi}: ${JSON.stringify(acts)}`);
  }
  if (e.actionsMention) {
    const joined = acts.join(" ").toLowerCase();
    for (const word of e.actionsMention)
      if (!joined.includes(word.toLowerCase()))
        problems.push(`no action mentions "${word}": ${JSON.stringify(acts)}`);
  }
  if (e.routeTo && out.threadId !== e.routeTo)
    problems.push(`routed to ${out.threadId ?? "a new thread"} instead of ${e.routeTo}`);
  if (e.newThread && (out.threadId !== null || !out.threadName))
    problems.push(
      `wanted a new thread, got threadId=${out.threadId} threadName=${out.threadName}`
    );
  if (e.shelfIn && !e.shelfIn.includes(out.shelfLife))
    problems.push(`shelfLife "${out.shelfLife}" not in [${e.shelfIn}]`);
  return problems;
}

let passed = 0;
const failures = [];
console.log(`sort cases → ${BASE} (${CASES.length} cases)\n`);
for (const tc of CASES) {
  process.stdout.write(`  ${tc.id.padEnd(24)}`);
  try {
    const out = await sortOnce(tc.raw, tc.threads);
    const problems = judge(tc, out);
    if (problems.length) {
      console.log(`FAIL (via ${out.via || "?"})`);
      for (const p of problems) console.log(`    - ${p}`);
      failures.push({ id: tc.id, why: tc.why, problems });
    } else {
      console.log(`ok (via ${out.via || "?"}, kind ${out.kind})`);
      passed++;
    }
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    failures.push({ id: tc.id, why: tc.why, problems: [String(err.message)] });
  }
  await sleep(1500);
}

console.log(`\n${passed}/${CASES.length} passed`);
if (failures.length) {
  console.log("\nWhat each failure means:");
  for (const f of failures) console.log(`  ${f.id} — ${f.why}`);
  process.exit(1);
}
