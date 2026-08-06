#!/usr/bin/env node
/**
 * Probe: does the reworked Distill clarifier act on intent instead of
 * interrogating? (specs/distill-intelligence.md)
 *
 * Drives the REAL /api/distill route — the actual prompts and provider chain.
 * The chat op runs through five conversations; the settle op then checks that
 * feedback-only discussion stays a thread while an explicit user-owned next
 * step becomes a direct action.
 *
 * Usage:  node scripts/probe-distill.mjs [base-url]
 *   base-url defaults to http://localhost:3000. The dev server must be up
 *   (npm run dev) and .env.local must hold the provider keys.
 *
 * Pass criteria (from the spec):
 *   - ≤ 1 question per conversation, never 2+
 *   - a concrete draft stated by turn 2 (concrete scenario)
 *   - a confirmation ("yes") closes with [ready] on the next turn
 *   - no restating of the user's words
 *   - the vague case still reaches [ready] within 3 turns
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

/* .env.local lives next to the script (project root), not in the caller's
   cwd — resolve it from the script itself so the probe runs from anywhere. */
const ENV_LOCAL = fileURLToPath(new URL("../.env.local", import.meta.url));

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
  return cookie;
}

let cookie = null;
let retries = 0;

async function chat(turns) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}/api/distill`, {
    method: "POST",
    headers,
    body: JSON.stringify({ op: "chat", turns }),
  });
  if (res.status === 401) {
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

async function settle(turns) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}/api/distill`, {
    method: "POST",
    headers,
    body: JSON.stringify({ op: "settle", turns }),
  });
  if (res.status === 401) {
    throw new Error("unauthorized — could not log in. Is APP_PASSWORD set on the server?");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`settle ${res.status}: ${body.error || res.statusText}`);
  }
  return await res.json();
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

/* The draft is stated when the reply frames what it would file — a record
   kind or a "I'd file this as…" construction — rather than just a bare
   question. */
function statesDraft(reply) {
  return /(i'd|i would|i'll|we'd)\b|file this|this as|a thread (about|on)|an? (action|thread|intention)[:.]|sounds like (a|an)/i.test(
    reply
  );
}

function facts(reply, lastUser) {
  const trimmed = reply.trim();
  return {
    ready: /\[ready\]/.test(trimmed),
    question: trimmed.includes("?"),
    restate: restates(trimmed, lastUser),
    draft: statesDraft(trimmed),
    text: trimmed,
  };
}

/* Run one scenario. `userTurns` are the fixed things the user says; the
   conversation stops as soon as the assistant closes with [ready] or the
   turn cap is reached. */
async function runScenario(name, userTurns, cap = 3) {
  const turns = [];
  const replyLog = [];
  let questions = 0;
  let readyAt = null;
  let draftByTurn2 = null;

  for (let i = 0; i < userTurns.length && readyAt === null; i++) {
    turns.push({ role: "user", text: userTurns[i] });
    const reply = await chat(turns);
    const f = facts(reply, userTurns[i]);
    turns.push({ role: "assistant", text: reply.trim() });
    replyLog.push(f);
    if (f.question) questions++;
    /* "By turn 2" covers the first two assistant replies, so a draft that
       appears on the confirmation reply (turn 2) still counts. */
    if (f.draft && i <= 1) draftByTurn2 = true;
    if (f.ready) readyAt = i + 1; // 1-based assistant-turn count
    await sleep(SLEEP_MS);
  }

  const results = {
    scenario: name,
    readyAt, // null = never closed
    questions,
    restated: replyLog.some((f) => f.restate),
    draftByTurn2: draftByTurn2 === true,
    closedInTurn: readyAt,
    replies: replyLog.map((f) => ({
      ready: f.ready,
      q: f.question,
      draft: f.draft,
      text: f.text.length > 160 ? f.text.slice(0, 157) + "…" : f.text,
    })),
  };

  results.passes = [
    readyAt !== null && readyAt <= cap, // closes in time
    questions <= 1, // the question budget held
    !results.restated, // never echoes the user back
  ];

  return results;
}

const scenarios = [
  {
    name: "STARTER · stuck on the job",
    cap: 3,
    userTurns: [
      "I'm stuck on whether to leave my job.",
      "Right — the money's good, but I'm burned out.",
    ],
  },
  {
    name: "STARTER · fuzzy app idea",
    cap: 3,
    userTurns: [
      "I have an idea for an app but it's fuzzy.",
      "It's for myself, mostly.",
    ],
  },
  {
    name: "STARTER · putting something off",
    cap: 3,
    userTurns: [
      "I keep putting off one thing — I don't know why.",
      "That's it exactly.",
    ],
  },
  {
    name: "CONCRETE · newsletter about brewing",
    cap: 2,
    /* The draft may close immediately, or ask a confirmation — either way
       the user confirms, and the next reply must carry [ready]. */
    userTurns: [
      "I want to start a newsletter about brewing coffee.",
      "Yes, that's right.",
    ],
  },
  {
    name: "VAGUE · idea but fuzzy",
    cap: 3,
    userTurns: [
      "I have an idea but it's fuzzy.",
      "I don't know, it's fuzzy.",
    ],
  },
];

const feedbackTurns = [
  {
    role: "user",
    text: "Capture sometimes turns a long feedback conversation into a task even though I am only explaining what feels wrong. The conversation itself and all the product detail should be kept, but there is no task in this feedback.",
  },
  {
    role: "assistant",
    text: "I'd file this as product feedback under Distill classification and create an internal filing action for the team.",
  },
  {
    role: "user",
    text: "Yes, that captures the feedback I wanted to preserve.",
  },
];

const explicitActionTurns = [
  ...feedbackTurns.slice(0, 2),
  {
    role: "user",
    text: "I will fix Capture's distill behavior for long feedback conversations.",
  },
];

const metaAction = /\b(file|filing|categorize|category|save (?:this|the conversation) as|record this under)\b/i;

async function main() {
  cookie = await sessionCookie();
  console.log(`Probing ${BASE}/api/distill — the real chain.`);
  console.log(cookie ? "Authenticated with a session cookie.\n" : "Gate disabled — no password needed.\n");
  const rows = [];
  for (const s of scenarios) {
    console.log(`—— ${s.name} ——`);
    const r = await runScenario(s.name, s.userTurns, s.cap);
    rows.push(r);
    if (r.readyAt) {
      console.log(`  closed with [ready] on turn ${r.readyAt} · ${r.questions} question(s)`);
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
  const concrete = rows.find((r) => r.scenario.includes("CONCRETE"));
  const draftOk = concrete ? concrete.draftByTurn2 : false;

  console.log("════════════════════════════════════");
  console.log("PASS CRITERIA");
  let all = true;
  for (const r of rows) {
    const ok = r.passes.every(Boolean);
    if (!ok) all = false;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${r.scenario}: ` +
        `closes ≤${r.closedInTurn ? r.closedInTurn : "never"} · ` +
        `${r.questions} question(s) · ${r.restated ? "restated ✗" : "no restate"}`
    );
  }
  console.log(
    `  ${draftOk ? "PASS" : "FAIL"}  CONCRETE draft stated by turn 2 (record kind + framing)`
  );
  if (!draftOk) all = false;

  console.log("\nSETTLE REGRESSIONS");
  const feedback = await settle(feedbackTurns);
  const feedbackOk =
    feedback.kind === "thread" &&
    Array.isArray(feedback.actions) &&
    feedback.actions.length === 0;
  console.log(
    `  ${feedbackOk ? "PASS" : "FAIL"}  feedback-only discussion → thread with no actions`
  );
  if (!feedbackOk) {
    console.log(`    received: ${feedback.kind} · ${JSON.stringify(feedback.actions)}`);
    all = false;
  }

  await sleep(SLEEP_MS);
  const explicit = await settle(explicitActionTurns);
  const actionText = Array.isArray(explicit.actions)
    ? explicit.actions.join(" ")
    : "";
  const explicitOk =
    explicit.kind === "action" &&
    actionText.length > 0 &&
    actionText.length <= 120 &&
    /fix capture.*distill.*long feedback/i.test(actionText) &&
    !metaAction.test(actionText);
  console.log(
    `  ${explicitOk ? "PASS" : "FAIL"}  explicit user-owned next step → short direct action`
  );
  if (!explicitOk) {
    console.log(`    received: ${explicit.kind} · ${JSON.stringify(explicit.actions)}`);
    all = false;
  }

  console.log(
    all
      ? "\nOverall: PASS — the clarifier acts on intent."
      : "\nOverall: FAIL — see the failing rows above."
  );
  process.exit(all ? 0 : 1);
}

main().catch((e) => {
  console.error(`\nProbe failed: ${e.message}`);
  console.error("Is the dev server running? (npm run dev, then retry.)");
  process.exit(1);
});
