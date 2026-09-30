/**
 * Does Ask + Tidy clean-up actually help? One eval, one messy board.
 *
 *   npm run eval:help                     offline: baseline + harness self-check
 *   CAPTURE_EVAL_TARGET=http://localhost:3000 npm run eval:help
 *   CAPTURE_EVAL_TARGET=https://<preview>.vercel.app CAPTURE_EVAL_RUNS=3 npm run eval:help
 *
 * It measures four things on evals/help.fixture.ts:
 *
 *   Ask       questions answered correctly, against how many the old
 *             word-matched Recall could even have shown the model
 *   One-liners  noise removed and misfiled notes moved, against keepers harmed
 *   Similar   real repeats combined, against look-alike traps combined
 *   Safety    every labelled fact still on the board after Approve all
 *
 * Without a target it still runs everything that needs no model: the old
 * Recall baseline, and an oracle pass that feeds the scorer ideal answers,
 * so a live score below 100% is the model's, never the harness's.
 *
 * A live run spends real model quota: about 20 calls per run. Point it at a
 * local server or a PREVIEW, never production — it writes nothing, but it
 * is still someone's quota. Results land in outputs/eval-help/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { askContext, readAnswer, type AskResult } from "@/lib/ask";
import {
  applyOneLiners, oneLinerContext, oneLiners, readVerdicts, type OneLinerProposal,
} from "@/lib/cleanup";
import { applyCombine, combineContext, readCombine, type CombineProposal } from "@/lib/combine";
import type { Board } from "@/lib/model";
import { isLikelyRecallQuestion, recallSources } from "./legacyRecall";
import {
  NOW, board, facts, misfiled, noise, questions, repeatIds, repeats, traps, type AskCase,
} from "./help.fixture";

const TARGET = process.env.CAPTURE_EVAL_TARGET?.replace(/\/+$/, "");
const RUNS = Math.max(1, Math.min(10, Number(process.env.CAPTURE_EVAL_RUNS) || 1));

function checkTarget(target: string) {
  const url = new URL(target);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!local && !(url.protocol === "https:" && url.hostname.endsWith(".vercel.app"))) {
    throw new Error("CAPTURE_EVAL_TARGET must be localhost or an https *.vercel.app preview");
  }
}

async function post(route: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${TARGET}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${route} ${res.status}: ${(value as { error?: string })?.error ?? ""}`);
  return value;
}

/* ------------------------------- scoring ------------------------------- */

type AskScore = { q: string; ok: boolean; pointed: boolean; answer: string; why?: string };

function scoreAsk(c: AskCase, result: AskResult | null, threadRef: (id: string) => boolean): AskScore {
  if (!result) return { q: c.q, ok: false, pointed: false, answer: "", why: "no usable answer" };
  const missing = (c.must ?? []).filter((r) => !r.test(result.answer));
  const wrong = (c.mustNot ?? []).filter((r) => r.test(result.answer));
  const why = result.found !== c.found ? `found=${result.found}, expected ${c.found}`
    : missing.length ? `missing ${missing.join(" ")}`
      : wrong.length ? `says ${wrong.join(" ")}` : undefined;
  return { q: c.q, ok: !why, pointed: !c.thread || threadRef(c.thread), answer: result.answer, why };
}

const where = (b: Board, id: string) => b.threads.find((t) => t.frags.some((f) => f.id === id))?.id;

function scoreOneLiners(proposals: OneLinerProposal[]) {
  const caught = noise.filter((id) => proposals.some((p) => p.item.id === id && p.verdict === "remove"));
  const moved = Object.entries(misfiled).filter(([id, to]) =>
    proposals.some((p) => p.item.id === id && p.verdict === "move" && p.to?.id === to));
  const harm = proposals.filter((p) => {
    if (p.verdict === "remove") return !noise.includes(p.item.id) && !repeatIds.has(p.item.id);
    return misfiled[p.item.id] !== p.to?.id && !noise.includes(p.item.id);
  }).map((p) => `${p.verdict} "${p.item.text}"${p.to ? ` → ${p.to.name}` : ""} (${p.reason})`);
  return { caught: caught.length, moved: moved.length, harm };
}

function scoreCombine(proposals: CombineProposal[], raw: number) {
  const has = (pair: string[]) => proposals.some((p) => pair.every((id) => p.frags.some((f) => f.id === id)));
  const found = repeats.filter(has).length;
  const trapped = traps.filter(has).map((pair) => pair.join("+"));
  return { found, trapped, refused: Math.max(0, raw - proposals.length) };
}

/** Every labelled fact must still be written somewhere live on the board. */
function survivingFacts(b: Board) {
  const text = [
    ...b.threads.flatMap((t) => t.frags.map((f) => f.text)),
    ...b.actions.filter((a) => !a.faded).map((a) => a.text),
    ...b.intentions.map((i) => i.expandedIntention),
  ].join("\n");
  return facts.filter((f) => !text.includes(f));
}
const size = (b: Board) =>
  b.threads.reduce((n, t) => n + t.frags.length, 0) + b.actions.filter((a) => !a.faded && !a.done).length;

/* --------------------------------- run --------------------------------- */

type Replies = {
  ask: (c: AskCase, ctx: ReturnType<typeof askContext>) => Promise<unknown>;
  oneLiners: (text: string) => Promise<unknown>;
  combine: (text: string) => Promise<unknown>;
};

async function evaluate(replies: Replies) {
  const ctx = askContext(board, NOW);
  const ask: AskScore[] = [];
  for (const c of questions) {
    let result: AskResult | null = null;
    try { result = readAnswer(await replies.ask(c, ctx), ctx.refs); } catch { /* scored as no answer */ }
    ask.push(scoreAsk(c, result, (id) => !!result?.refs.some((r) => r.kind === "thread" && r.id === id)));
  }

  const lineCtx = oneLinerContext(board, oneLiners(board), NOW);
  let lineProposals: OneLinerProposal[] = [];
  try { lineProposals = readVerdicts(await replies.oneLiners(lineCtx.text), lineCtx) ?? []; } catch { /* none */ }

  const combCtx = combineContext(board, NOW);
  let combProposals: CombineProposal[] = [];
  let raw = 0;
  try {
    const value = await replies.combine(combCtx.text);
    raw = (value as { groups?: unknown[] })?.groups?.length ?? 0;
    combProposals = readCombine(value, combCtx) ?? [];
  } catch { /* none */ }

  /* Approve all, both passes, exactly as the app would apply them. */
  let n = 0;
  const afterLines = applyOneLiners(board, lineProposals, NOW, () => `eval${n++}`)?.board ?? board;
  const after = applyCombine(afterLines, combProposals, NOW)?.board ?? afterLines;
  return {
    ask,
    oneLiners: scoreOneLiners(lineProposals),
    combine: scoreCombine(combProposals, raw),
    lostFacts: survivingFacts(after),
    notes: { before: size(board), after: size(after) },
    misfiledHome: Object.keys(misfiled).map((id) => ({ id, now: where(after, id) })),
  };
}
type Result = Awaited<ReturnType<typeof evaluate>>;

/** Ideal replies built from the labels — the ceiling the scorer must reach. */
const oracle: Replies = {
  async ask(c, ctx) {
    const byId = new Map([...board.threads.flatMap((t) => t.frags), ...board.actions].map((x) => [x.id, x.text]));
    const label = Object.entries(ctx.refs).find(([, r]) => r.kind === "thread" && r.id === c.thread)?.[0];
    return c.found
      ? { found: true, answer: (c.evidence ?? []).map((id) => byId.get(id)).join("\n\n"), refs: label ? [label] : [] }
      : { found: false, answer: "Nothing on your board mentions that.", refs: [] };
  },
  async oneLiners(text) {
    const ref = (id: string) => text.match(new RegExp(`\\[(L\\d+)\\] \\([^)]*\\) ${escape(textOf(id))}$`, "m"))?.[1];
    const tref = (id: string) => text.match(new RegExp(`\\[(T\\d+)\\] ${escape(board.threads.find((t) => t.id === id)!.name)}`))?.[1];
    return { changes: [
      ...noise.map((id) => ({ ref: ref(id), verdict: "remove", to: null, reason: "Filler." })),
      ...Object.entries(misfiled).map(([id, to]) => ({ ref: ref(id), verdict: "move", to: tref(to), reason: "Misfiled." })),
    ].filter((c) => c.ref) };
  },
  async combine(text) {
    const ref = (id: string) => text.match(new RegExp(`\\[(N\\d+)\\] [^:]+: ${escape(textOf(id))}$`, "m"))?.[1];
    return { groups: repeats.map((pair) => ({
      notes: pair.map(ref).filter(Boolean), combined: pair.map(textOf).join(" / "), reason: "Same thought.",
    })) };
  },
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const textOf = (id: string) =>
  [...board.threads.flatMap((t) => t.frags), ...board.actions].find((x) => x.id === id)!.text.trim();

/** Replies that do harm — the scorer must catch every one. */
const vandal: Replies = {
  ask: async () => ({ found: true, answer: "You decided on monthly at $10.", refs: [] }),
  async oneLiners(text) {
    const ref = (id: string) => text.match(new RegExp(`\\[(L\\d+)\\] \\([^)]*\\) ${escape(textOf(id))}$`, "m"))?.[1];
    return { changes: ["a6", "li5"].map((id) => ({ ref: ref(id), verdict: "remove", to: null, reason: "Short." })) };
  },
  async combine(text) {
    const ref = (id: string) => text.match(new RegExp(`\\[(N\\d+)\\] [^:]+: ${escape(textOf(id))}$`, "m"))?.[1];
    return { groups: [{ notes: ["ki5", "ki6"].map(ref), combined: `${textOf("ki5")} ${textOf("ki6")}`, reason: "Island." }] };
  },
};

const live: Replies = {
  ask: (c, ctx) => post("/api/ask", { question: c.q, board: ctx.text }),
  oneLiners: (text) => post("/api/cleanup", { board: text }),
  combine: (text) => post("/api/combine", { board: text }),
};

/* ------------------------------- report ------------------------------- */

function legacyReach() {
  const ctx = askContext(board, NOW);
  const answerable = questions.filter((c) => c.found);
  const old = answerable.filter((c) => isLikelyRecallQuestion(c.q) && recallSources(board, c.q)
    .some((s) => c.evidence!.includes(s.fragId ?? s.targetId)));
  const now = answerable.filter((c) => c.evidence!.some((id) => ctx.text.includes(textOf(id))));
  return { answerable: answerable.length, old: old.length, now: now.length, missedByOld: answerable.filter((c) => !old.includes(c)).map((c) => c.q) };
}

function report(label: string, runs: Result[]) {
  const sum = (f: (r: Result) => number) => runs.reduce((n, r) => n + f(r), 0);
  const avg = (f: (r: Result) => number) => +(sum(f) / runs.length).toFixed(1);
  const qs = questions.length;
  const answerable = questions.filter((c) => c.found).length;
  const lines = [
    `\n── ${label} (${runs.length} run${runs.length === 1 ? "" : "s"}) ──`,
    `Ask        correct            ${avg((r) => r.ask.filter((a) => a.ok).length)}/${qs}` +
      `   (answerable ${avg((r) => r.ask.filter((a, i) => a.ok && questions[i].found).length)}/${answerable},` +
      ` says "not on your board" ${avg((r) => r.ask.filter((a, i) => a.ok && !questions[i].found).length)}/${qs - answerable})`,
    `           points at thread   ${avg((r) => r.ask.filter((a, i) => a.pointed && questions[i].thread).length)}/${questions.filter((c) => c.thread).length}`,
    `One-liners noise removed      ${avg((r) => r.oneLiners.caught)}/${noise.length}`,
    `           misfiled moved     ${avg((r) => r.oneLiners.moved)}/${Object.keys(misfiled).length}`,
    `           keepers harmed     ${avg((r) => r.oneLiners.harm.length)}   (must be 0)`,
    `Similar    repeats combined   ${avg((r) => r.combine.found)}/${repeats.length}`,
    `           traps combined     ${avg((r) => r.combine.trapped.length)}   (must be 0)`,
    `           refused by guard   ${avg((r) => r.combine.refused)}`,
    `Safety     facts lost         ${avg((r) => r.lostFacts.length)}   (must be 0)`,
    `           board size         ${runs[0].notes.before} → ${avg((r) => r.notes.after)} notes and open tasks`,
  ];
  const misses = runs.flatMap((r) => [
    ...r.ask.filter((a) => !a.ok).map((a) => `  ✗ Ask "${a.q}": ${a.why}${a.answer ? ` — "${a.answer.slice(0, 140).replace(/\n/g, " ")}"` : ""}`),
    ...r.oneLiners.harm.map((h) => `  ✗ one-liner harm: ${h}`),
    ...r.combine.trapped.map((t) => `  ✗ combined a trap: ${t}`),
    ...r.lostFacts.map((f) => `  ✗ fact lost: ${f}`),
  ]);
  if (misses.length) lines.push("Misses:", ...[...new Set(misses)]);
  console.log(lines.join("\n"));
}

it("Ask and Tidy clean-up help on a messy board", async () => {
  const base = legacyReach();
  console.log([
    "\n══ Help eval — evals/help.fixture.ts ══",
    `Before (word-matched Recall): the note that answers the question reached the model for ${base.old}/${base.answerable} answerable questions.`,
    `After (Ask reads the board):  it reaches the model for ${base.now}/${base.answerable}.`,
    `Never reachable before:${base.missedByOld.map((q) => `\n  · ${q}`).join("")}`,
  ].join("\n"));

  // The scorer must be able to reach the ceiling, or live numbers mean nothing.
  const ideal = await evaluate(oracle);
  report("Oracle — ideal replies, proves the scorer", [ideal]);
  expect(ideal.ask.every((a) => a.ok && a.pointed)).toBe(true);
  expect(ideal.oneLiners).toMatchObject({ caught: noise.length, moved: Object.keys(misfiled).length, harm: [] });
  expect(ideal.combine).toMatchObject({ found: repeats.length, trapped: [] });
  expect(ideal.lostFacts).toEqual([]);
  expect(base.now).toBe(base.answerable);

  // …and it must catch harm, or a clean live score means nothing either.
  const harmful = await evaluate(vandal);
  expect(harmful.ask.filter((a) => a.ok).length).toBeLessThan(3);
  expect(harmful.oneLiners.harm).toHaveLength(2);
  expect(harmful.combine.trapped).toEqual(["ki5+ki6"]);
  expect(harmful.lostFacts).toEqual(expect.arrayContaining(["Renew passport", "+351 912 345 678"]));

  if (!TARGET) {
    console.log("\nNo CAPTURE_EVAL_TARGET set — live model pass skipped.");
    return;
  }
  checkTarget(TARGET);
  const runs: Result[] = [];
  for (let i = 0; i < RUNS; i++) runs.push(await evaluate(live));
  report(`Live — ${TARGET}`, runs);
  mkdirSync("outputs/eval-help", { recursive: true });
  const out = `outputs/eval-help/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify({ target: TARGET, at: new Date().toISOString(), baseline: base, runs }, null, 2));
  console.log(`\nWritten: ${out}`);
}, 30 * 60_000);
