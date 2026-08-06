#!/usr/bin/env node
/**
 * Probe: does the reworked Distill clarifier act on intent instead of
 * interrogating? (specs/distill-intelligence.md)
 *
 * Drives the REAL /api/distill chat op — the actual prompt, the actual
 * question budget, the actual provider chain — through five conversations:
 * the three in-app STARTERS, one concrete message, and one genuinely vague
 * one. Reports the spec's pass criteria per scenario.
 *
 * Usage:  node scripts/probe-distill.mjs [base-url]
 *   base-url defaults to http://localhost:3000. The dev server must be up
 *   (npm run dev) and .env.local must hold the provider keys.
 *
 * Pass criteria (from the spec):
 *   - the engine never talks about filing — no "I'd file this as…", no
 *     kinds, no "nothing to capture" (that was the v1 mistake)
 *   - ≤ 2 questions per conversation (a ceiling, not a target)
 *   - a greeting is answered warmly and NEVER closes the conversation
 *   - a real thought closes with [ready] within a few turns
 *   - no restating of the user's words
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

/* .env.local lives next to the script (project root), not in the caller's
   cwd — resolve it from the script itself so the probe runs from anywhere. */
const ENV_LOCAL = fileURLToPath(new URL("../.env.local", import.meta.url));

/* A session cookie is cached to disk so repeated probe runs never trip the
   login rate limiter (several 429s in a row lock you out for minutes). */
const COOKIE_CACHE = fileURLToPath(new URL("../.freebuff/probe-cookie.txt", import.meta.url));

const BASE = process.argv[2] || "http://localhost:3000";
const SLEEP_MS = 600; // be gentle with the free tiers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The app's single-user gate (src/proxy.ts). Read APP_PASSWORD from the
   same .env.local the server uses — the password itself never prints. */
function appPassword() {
  if (process.env.APP_PASSWORD) return process.env.APP_PASSWORD;
  try {
    const raw = fs.readFileSync(ENV_LOCAL, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^APP_PASSWORD=(.*)$/);
      if (m) {
        // Next's dotenv loader strips surrounding quotes; match it exactly.
        // (An escaped quote inside the value — APP_PASSWORD="a\"b" — would
        // differ from dotenv's unescaping; a personal password never needs
        // that, so the simple strip is enough.)
        let v = m[1].trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        return v;
      }
    }
  } catch {
    /* no .env.local — the gate is off */
  }
  return null;
}

/* Log in once, keep the session cookie. Returns the Cookie header to send,
   or null when the gate is disabled (no APP_PASSWORD configured). */
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
  const cookie = setCookie.split(";")[0]; // name=value
  fs.mkdirSync(fileURLToPath(new URL("../.freebuff", import.meta.url)), { recursive: true });
  fs.writeFileSync(COOKIE_CACHE, cookie);
  return cookie;
}

let cookie = null;
let retries = 0;
let relogged = false;

async function chat(turns) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}/api/distill`, {
    method: "POST",
    headers,
    body: JSON.stringify({ op: "chat", turns }),
  });
  if (res.status === 401) {
    /* Stale cached session (server restarted with a different password, or
       the 30-day expiry passed) — drop it and log in fresh, once. */
    if (!relogged) {
      relogged = true;
      try {
        fs.rmSync(COOKIE_CACHE);
      } catch {}
      cookie = await sessionCookie();
      if (cookie) return chat(turns);
    }
    throw new Error("unauthorized — could not log in. Is APP_PASSWORD set on the server?");
  }
  if (res.status === 429) {
    // The model bucket allows 40/min; a real quota-exhausted chain could
    // keep 429ing, so give up after a few waits instead of looping forever.
    if (retries >= 3) throw new Error("rate limited persistently — aborting");
    retries++;
    const retry = Number(res.headers.get("Retry-After") || 5);
    console.log(`    429 — rate limited, waiting ${retry}s…`);
    await sleep(retry * 1000);
    return chat(turns);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`chat ${res.status}: ${body.error || res.statusText}`);
  }
  return await res.text();
}

/* Normalise for word-overlap checks: lowercase, strip punctuation, collapse
   whitespace. */
const words = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/* Restating = a run of >=5 consecutive words of the user's message inside
   the assistant's reply, in order. Catches "so you're stuck on whether to
   leave your job". */
function restates(reply, userText) {
  const r = words(reply);
  const u = words(userText);
  if (u.length < 5) return false;
  for (let i = 0; i + 5 <= u.length; i++) {
    const run = u.slice(i, i + 5).join(" ");
    if (r.join(" ").includes(run)) return true;
  }
  return false;
}

/* Filing talk — the v1 mistake the engine must never make during a chat:
   naming what it would file, saying where something will go, or waving a
   greeting off as "nothing to capture". */
function filingTalk(reply) {
  return /i'?d file|i would file|file this (as|in)|file that|friendly greeting|nothing to capture|this as a (thread|record|note)|as an? (action|thread|intention)/i.test(
    reply
  );
}

function facts(reply, lastUser) {
  const trimmed = reply.trim();
  const ready = /\[ready\]/.test(trimmed);
  const nothing = /\[nothing\]/.test(trimmed);
  return {
    ready,
    nothing,
    /* "ask" is a question left hanging. A reply that ends in [ready] (even
       a forced one) is a close, not an ask — the budget enforcement appends
       [ready] to a question the model tried to sneak past its limit, so the
       count must not treat that enforcement as interrogation. */
    ask: trimmed.includes("?") && !ready && !nothing,
    question: trimmed.includes("?"),
    restate: restates(trimmed, lastUser),
    filing: filingTalk(trimmed),
    text: trimmed,
  };
}

/* Run one scenario. `mode` says what a good outcome looks like:
   - "close": the conversation should settle — [ready] within `cap` turns
   - "smalltalk": the conversation must NOT close on greetings — no marker
     at all, just warm replies that keep the door open */
async function runScenario(name, userTurns, cap = 3, mode = "close") {
  const turns = [];
  const replyLog = [];
  let questions = 0;
  let readyAt = null;
  let nothingAt = null;

  const closed = () => readyAt ?? nothingAt;
  for (let i = 0; i < userTurns.length && closed() === null; i++) {
    turns.push({ role: "user", text: userTurns[i] });
    const reply = await chat(turns);
    const f = facts(reply, userTurns[i]);
    turns.push({ role: "assistant", text: reply.trim() });
    replyLog.push(f);
    if (f.ask) questions++;
    if (f.ready) readyAt = i + 1; // 1-based assistant-turn count
    if (f.nothing) nothingAt = i + 1;
    await sleep(SLEEP_MS);
  }

  const results = {
    scenario: name,
    mode,
    readyAt,
    nothingAt,
    questions,
    restated: replyLog.some((f) => f.restate),
    filing: replyLog.some((f) => f.filing),
    wavedOff: replyLog.some((f) => /nothing to capture/i.test(f.text)),
    closedInTurn: closed(),
    replies: replyLog.map((f) => ({
      ready: f.ready,
      nothing: f.nothing,
      q: f.question,
      filing: f.filing,
      text: f.text.length > 160 ? f.text.slice(0, 157) + "…" : f.text,
    })),
  };

  if (mode === "smalltalk") {
    /* A greeting is answered, never filed and never closed. */
    results.passes = [
      closed() === null, // never ended the conversation
      !results.filing, // never talked about filing
      !results.wavedOff, // never said "nothing to capture"
      questions <= 2,
      !results.restated,
    ];
  } else {
    results.passes = [
      readyAt !== null && readyAt <= cap, // closes on [ready] in time
      !results.filing, // never talked about filing along the way
      questions <= 2,
      !results.restated,
    ];
  }

  return results;
}

const scenarios = [
  {
    name: "STARTER · stuck on the job",
    cap: 3,
    userTurns: [
      "I'm stuck on whether to leave my job.",
      "Right — the money's good, but I'm burned out.",
      "Yes, that's exactly it.",
    ],
  },
  {
    name: "STARTER · fuzzy app idea",
    cap: 3,
    userTurns: [
      "I have an idea for an app but it's fuzzy.",
      "It's for myself, mostly.",
      "Right, it's something I'd use every day.",
    ],
  },
  {
    name: "STARTER · putting something off",
    cap: 3,
    userTurns: [
      "I keep putting off one thing — I don't know why.",
      "That's it exactly.",
      "Yes.",
    ],
  },
  {
    name: "CONCRETE · newsletter about brewing",
    cap: 3,
    /* The engine may close as soon as the thought is clear, or ask one
       question — either way the user confirms, and a later reply must carry
       [ready] within the cap. */
    userTurns: [
      "I want to start a newsletter about brewing coffee.",
      "Yes, that's right.",
      "It's for people getting into pour-over.",
    ],
  },
  {
    /* The budget is a ceiling, not a target: two questions max across the
       whole conversation, then a forced close. The fourth turn exists to
       prove the enforcement — after two questions, the engine must close
       with [ready] however rough the record is. */
    name: "VAGUE · idea but fuzzy",
    cap: 4,
    userTurns: [
      "I have an idea but it's fuzzy.",
      "I don't know, it's fuzzy.",
      "It's for something I'd use every day.",
      "That's a fair way to put it.",
    ],
  },
  {
    /* The user drives: they ask the assistant a direct question. The engine
       answers — no new ask — and once the budget is spent (or the exchange
       has settled), the conversation closes with [ready]. A forced close is
       a documented budget behavior, corrected in the settle preview. */
    name: "USER DRIVES · asks for a take",
    cap: 4,
    userTurns: [
      "I keep going back and forth on leaving my job.",
      "What do you think I should do?",
      "You're right, staying for now makes sense.",
      "Yeah, let's leave it there.",
    ],
  },
  {
    name: "SMALL TALK · greeting then nothing",
    cap: 3,
    mode: "smalltalk",
    /* A greeting is answered warmly and the conversation stays open — no
       [ready], no [nothing], no filing talk. If the user only says hi, the
       exchange simply continues until they bring something real or leave. */
    userTurns: [
      "Hey, how are you doing today?",
      "I'm good, thanks. Just saying hi, really.",
    ],
  },
];

async function main() {
  cookie = await sessionCookie();
  console.log(`Probing ${BASE}/api/distill — the real chain.`);
  console.log(cookie ? "Authenticated with a session cookie.\n" : "Gate disabled — no password needed.\n");
  const rows = [];
  for (const s of scenarios) {
    console.log(`—— ${s.name} ——`);
    const r = await runScenario(s.name, s.userTurns, s.cap, s.mode || "close");
    rows.push(r);
    if (r.readyAt) {
      console.log(`  closed with [ready] on turn ${r.readyAt} · ${r.questions} question(s)`);
    } else if (r.nothingAt) {
      console.log(`  waved off with [nothing] on turn ${r.nothingAt} · ${r.questions} question(s)`);
    } else {
      console.log(`  NEVER closed · ${r.questions} question(s)`);
    }
    if (r.restated) console.log("  ✗ restated the user's words");
    for (const f of r.replies) {
      console.log(`    [${f.q ? "?" : "·"}${f.ready ? "R" : "·"}${f.draft ? "D" : "·"}] ${f.text}`);
    }
    console.log("");
  }

  /* The concrete scenario's draft-by-turn-2 is judged on its own, since the
     other scenarios may legitimately close before a draft sentence. */
  console.log("════════════════════════════════════");
  console.log("PASS CRITERIA");
  let all = true;
  for (const r of rows) {
    const ok = r.passes.every(Boolean);
    if (!ok) all = false;
    const outcome =
      r.mode === "smalltalk"
        ? r.closedInTurn
          ? "closed ✗"
          : "stayed open ✓"
        : `[ready] on ${r.closedInTurn ? "turn " + r.closedInTurn : "never ✗"}`;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${r.scenario}: ${outcome} · ` +
        `${r.questions} question(s) · ${r.restated ? "restated ✗" : "no restate"} · ` +
        `${r.filing ? "filing talk ✗" : "no filing talk"}`
    );
  }

  const allFilingFree = rows.every((r) => !r.filing && !r.wavedOff);
  console.log(
    `  ${allFilingFree ? "PASS" : "FAIL"}  no filing talk in any conversation — the chat stays natural`
  );
  if (!allFilingFree) all = false;

  console.log(
    all
      ? "\nOverall: PASS — the clarifier converses naturally and settles quietly."
      : "\nOverall: FAIL — see the failing rows above."
  );
  process.exit(all ? 0 : 1);
}

main().catch((e) => {
  console.error(`\nProbe failed: ${e.message}`);
  console.error("Is the dev server running? (npm run dev, then retry.)");
  process.exit(1);
});
