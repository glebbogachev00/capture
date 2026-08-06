#!/usr/bin/env node
/**
 * Probe: how well does /api/sort classify real captures?
 *
 * Drives the REAL sort endpoint — the actual prompt, the actual provider
 * chain — through a broad, tagged scenario set covering every kind (action,
 * thread, intention), the shapes that trip classifiers (long rambly dictation,
 * a want that is really an errand, a topic that looks like a task), and a set
 * of genuinely ambiguous captures where more than one kind is defensible.
 *
 * There is no ground-truth oracle for classification, so each scenario carries
 * an `expect`: one kind, or an array of acceptable kinds for the ambiguous
 * ones. The probe reports matches, flags mismatches for human review, and — for
 * actions — prints the shelf life so a "keep" that should fade (or vice versa)
 * is visible. Run it before and after a prompt change to see the effect.
 *
 * Usage:  node scripts/probe-sort.mjs [base-url] [--json]
 *   base-url defaults to http://localhost:3000. The dev server must be up
 *   (npm run dev) and .env.local must hold the provider keys.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ENV_LOCAL = fileURLToPath(new URL("../.env.local", import.meta.url));
const args = process.argv.slice(2).filter((a) => a !== "--json");
const JSON_OUT = process.argv.includes("--json");
const BASE = args[0] || "http://localhost:3000";
const SLEEP_MS = 700; // be gentle with the free tiers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- the single-user gate: read APP_PASSWORD, never print it ---- */
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
  if (!setCookie) throw new Error("login succeeded but no session cookie");
  return setCookie.split(";")[0];
}

let cookie = null;
let retries = 0;

async function sort(raw) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}/api/sort`, {
    method: "POST",
    headers,
    body: JSON.stringify({ raw, threads: [] }),
  });
  if (res.status === 401) throw new Error("unauthorized — is APP_PASSWORD set?");
  if (res.status === 429) {
    if (retries >= 4) throw new Error("rate limited persistently — aborting");
    retries++;
    const retry = Number(res.headers.get("Retry-After") || 5);
    console.log(`    429 — waiting ${retry}s…`);
    await sleep(retry * 1000);
    return sort(raw);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`sort ${res.status}: ${body.error || res.statusText}`);
  }
  return res.json();
}

/* ---------------------------------------------------------------------
   The scenarios. `expect` is one kind, or an array of acceptable kinds
   for a genuinely ambiguous capture. Grouped so the report reads clearly.
--------------------------------------------------------------------- */
const SCENARIOS = [
  // --- clear actions ---
  { g: "action", raw: "call the dentist back about the filling", expect: "action" },
  { g: "action", raw: "pick up the prescription before friday, they close early", expect: "action" },
  { g: "action", raw: "email sarah the colour grade notes before the screening", expect: "action" },
  { g: "action", raw: "pay the electricity bill, it's due on the 12th", expect: "action" },
  { g: "action", raw: "book flights for lisbon before the prices jump", expect: "action" },
  { g: "action", raw: "return the library books tomorrow", expect: "action" },
  { g: "action", raw: "text mum happy birthday on saturday", expect: "action" },

  // --- clear threads (thinking that accumulates) ---
  { g: "thread", raw: "been thinking about whether the studio should lean into slow cinema pacing, longer takes, less cutting", expect: "thread" },
  { g: "thread", raw: "reality transurfing keeps coming back to me, the idea that importance creates resistance", expect: "thread" },
  { g: "thread", raw: "ideas for the newsletter: maybe short essays, maybe a weekly link roundup, not sure of the angle yet", expect: "thread" },
  { g: "thread", raw: "notes on the character arc, he starts certain and ends humbled, need to earn the turn", expect: "thread" },
  { g: "thread", raw: "why do i keep procrastinating on the edit, something about fear of it being mediocre", expect: "thread" },

  // --- clear intentions (a state declared about oneself) ---
  { g: "intention", raw: "i want to actually enjoy my mornings instead of dreading them", expect: "intention" },
  { g: "intention", raw: "i want to stop taking on client work i resent just because the money is there", expect: "intention" },
  { g: "intention", raw: "i want to be the kind of person who finishes what they start", expect: "intention" },
  { g: "intention", raw: "i live somewhere with a lot of natural light and space to think", expect: "intention" },

  // --- traps: a want that is really an errand ---
  { g: "trap", raw: "i want to get milk on the way home", expect: "action" },
  { g: "trap", raw: "i really want to remember to send the invoice tomorrow", expect: "action" },
  // --- traps: a topic that looks like a task ---
  { g: "trap", raw: "been reading about sleep cycles and how the 90 minute thing might be a myth", expect: "thread" },
  // --- traps: commitment with money/consequences => action, shelf keep ---
  { g: "trap", raw: "promised dave i'd send him 200 quid for the concert tickets by the weekend", expect: "action" },

  // --- garbled dictation (should still land, usually action) ---
  { g: "garbled", raw: "um so i need to uh call the the dentist back about the filling thing and also grab the prescription before friday cause they close early i think", expect: "action" },

  // --- long rambly conversation-style input (the reported failure shape) ---
  { g: "long", raw: "okay so i've been going back and forth on this for weeks now, whether to leave the agency job. the money is genuinely good and it would be stupid to walk away from that, but every sunday i get this dread and i know that's not nothing. part of me thinks i should just save for another year and then jump, another part thinks the year will turn into three. i don't have a plan for what i'd do instead which is the scary bit. maybe freelance, maybe something completely different. i keep not deciding and that itself is a decision.", expect: "thread" },

  // --- genuinely ambiguous (either is defensible) ---
  { g: "ambiguous", raw: "i should really start going to the gym again", expect: ["action", "thread", "intention"] },
  { g: "ambiguous", raw: "thinking i need to have the hard conversation with my brother about the house", expect: ["action", "thread"] },
  { g: "ambiguous", raw: "want to read more this year, maybe a book a week", expect: ["intention", "thread", "action"] },
];

function tick(ok) {
  return ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
}

async function main() {
  console.log(`\nProbing /api/sort at ${BASE}\n`);
  try {
    cookie = await sessionCookie();
  } catch (e) {
    console.error("Could not log in:", e.message);
    process.exit(1);
  }

  const results = [];
  for (const s of SCENARIOS) {
    let out, err;
    try {
      out = await sort(s.raw);
    } catch (e) {
      err = e.message;
    }
    const accept = Array.isArray(s.expect) ? s.expect : [s.expect];
    const ok = out ? accept.includes(out.kind) : false;
    results.push({ ...s, got: out?.kind, shelf: out?.shelfLife, via: out?.via, ok, err });

    if (!JSON_OUT) {
      const label = Array.isArray(s.expect) ? s.expect.join("|") : s.expect;
      const line = err
        ? `\x1b[31mERR\x1b[0m ${err}`
        : `${tick(ok)} got ${String(out.kind).padEnd(9)} expect ${label.padEnd(24)} ${out.kind === "action" ? "shelf=" + out.shelfLife : ""}`;
      console.log(`[${s.g}] ${s.raw.slice(0, 58).padEnd(60)}`);
      console.log(`    ${line}  via ${out?.via ?? "-"}`);
    }
    await sleep(SLEEP_MS);
  }

  const scored = results.filter((r) => !r.err);
  const matched = scored.filter((r) => r.ok).length;
  const strict = results.filter((r) => !Array.isArray(r.expect) && !r.err);
  const strictMatched = strict.filter((r) => r.ok).length;

  if (JSON_OUT) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(`\n${"=".repeat(64)}`);
    console.log(`Matched ${matched}/${scored.length} overall`);
    console.log(`Unambiguous scenarios: ${strictMatched}/${strict.length}`);
    const misses = results.filter((r) => !r.ok && !r.err);
    if (misses.length) {
      console.log(`\nMismatches to review:`);
      for (const m of misses) {
        const label = Array.isArray(m.expect) ? m.expect.join("|") : m.expect;
        console.log(`  [${m.g}] "${m.raw.slice(0, 50)}…"`);
        console.log(`        expected ${label}, got ${m.got}`);
      }
    }
    const errs = results.filter((r) => r.err);
    if (errs.length) console.log(`\n${errs.length} scenario(s) errored — chain may be rate-limited.`);
  }

  // Non-zero exit if any UNAMBIGUOUS scenario is wrong, so CI/agents can gate.
  process.exit(strictMatched === strict.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
