/**
 * Does the sorter file thoughts the way the person means? A small, labelled
 * set mirroring the misses seen on the real board on 1 Oct 2026 (the cases
 * are invented; the shapes are real).
 *
 *   CAPTURE_EVAL_TARGET=http://localhost:3000 npm run eval:sort
 *   CAPTURE_EVAL_TARGET=https://<preview>.vercel.app CAPTURE_EVAL_RUNS=3 npm run eval:sort
 *
 * Each case names the step of the sorting plan it checks:
 *   1  one Thread per thought; "only save it in X" decides the Thread
 *   2  a concrete task of the person's own inside a longer thought
 *      becomes an action as well (the thought stays whole)
 *   -  behaviour that must not regress either way
 *
 * Without a target it proves the scorer on ideal and on harmful answers.
 * A live run is about one model call per case per run; point it at a local
 * server or a preview, never production.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { EMPTY, type Board } from "@/lib/model";
import { normalizeSimpleSort, type SimpleSortItem } from "@/lib/simpleSort";
import { threadBriefs } from "@/lib/threadBrief";

const TARGET = process.env.CAPTURE_EVAL_TARGET?.replace(/\/+$/, "");
const RUNS = Math.max(1, Math.min(10, Number(process.env.CAPTURE_EVAL_RUNS) || 1));
const NOW = new Date(2026, 9, 1, 12).getTime();

const t = (id: string, name: string, summary: string) =>
  ({ id, name, summary, frags: [{ id: `${id}-1`, at: NOW - 864e5 * 5, text: summary }] });

const board: Board = {
  ...EMPTY,
  threads: [
    t("reality", "Reality creation", "Practising reality creation: visualising the life I want, dropping obsession and desire, intentions lived as already true."),
    t("capture", "Capture", "Building Capture, the notes app: sorting, Ask, Tidy, sync and bugs."),
    t("friction", "Friction-removing strategy", "Workflows and habits that remove friction from my days, so agents do the building and I do less."),
    t("retake", "Retake", "Retake, the demo recording tool: recording, trimming, publishing demos."),
    t("health", "Health", "Walking, running, sleep and energy."),
  ],
  actions: [{ id: "open1", text: "Book the dentist", done: false, at: NOW - 864e5, shelf: "weeks", expires: null }],
};
const threads = threadBriefs(board.threads);
const actions = board.actions.map(({ id, text }) => ({ id, text }));

type Case = {
  step: "1" | "2" | "-";
  raw: string;
  /** Every thought must land in exactly these Threads (no others). */
  threads?: string[];
  /** Number of new actions expected (existing-action matches excluded). */
  actions?: number;
  /** Each pattern must match some action's text. */
  actionLike?: RegExp[];
  why: string;
};

const cases: Case[] = [
  { step: "1", raw: "Obsession and desire are really one problem for me: I obsess over building when the point is to live the future I want. Capture is just a byproduct of that.",
    threads: ["reality"], actions: 0, why: "a passing mention of Capture is not a second home" },
  { step: "1", raw: "This week I want to use Retake to record playful demos for Capture, without chasing perfection. Only save this in the friction strategy thread.",
    threads: ["friction"], why: "\"only save this in X\" decides the Thread" },
  { step: "1", raw: "Put this in Health: long walks after lunch clear my head better than coffee.",
    threads: ["health"], actions: 0, why: "a filing instruction is not an item" },
  { step: "1", raw: "Rest days need one long walk and nothing else. Separately, Retake should trim the silence at the start of every recording.",
    threads: ["health", "retake"], actions: 0, why: "two subjects split into two parts, one Thread each" },
  { step: "2", raw: "Most of what I say ends up as threads and almost never as actions. The thing I really need to do this week is send my capture history to my agent so it can pull the tasks out.",
    threads: ["capture"], actions: 1, actionLike: [/send .*history .*agent/i], why: "their own concrete task inside a longer thought" },
  { step: "2", raw: "I keep thinking Retake should have a story mode. I need to record three demo videos with Retake before Friday so I can see what the story looks like.",
    threads: ["retake"], actions: 1, actionLike: [/record .*demo/i], why: "a stated task beside the idea" },
  { step: "-", raw: "These sorting bugs need to be fixed: it copies notes into two threads and ignores where I tell it to save things.",
    threads: ["capture"], actions: 0, why: "a bug report is one thought, not a task list" },
  { step: "-", raw: "I should spend less time building and more time walking and visualising.",
    actions: 0, why: "a wish about life is not a task" },
  { step: "-", raw: "Message a creator on X and offer to help with AI.",
    actions: 1, why: "one task stays one action" },
  { step: "-", raw: Array.from({ length: 60 }, (_, i) =>
      `Retake research note ${i + 1}: demo recordings land better when the first ten seconds show the product working, the cursor moves slowly, and the trim removes the silence before the first click.`).join(" "),
    threads: ["retake"], actions: 0, why: "a very long note (over 10,000 characters) still sorts, kept whole" },
  { step: "-", raw: "By Friday I need to email Mia the invoice and renew the domain.",
    actions: 2, actionLike: [/mia/i, /domain/i], why: "two tasks, one deadline" },
];

type Score = { ok: boolean; why?: string };

function score(c: Case, items: SimpleSortItem[] | null): Score {
  if (!items) return { ok: false, why: "no usable answer" };
  const thoughts = items.filter((i) => i.kind === "thought");
  const fresh = items.filter((i) => i.kind === "action" && !i.existingActionId);
  const homes = thoughts.flatMap((i) => (i.threads ?? []).map((th) => ("id" in th ? th.id : `new:${th.name}`)));
  const copies = thoughts.length !== new Set(thoughts.map((i) => i.text.trim().toLowerCase())).size;
  if (copies) return { ok: false, why: "the same words landed twice" };
  if (c.threads && [...new Set(homes)].sort().join() !== [...c.threads].sort().join()) {
    return { ok: false, why: `threads ${homes.join(", ") || "none"}, expected ${c.threads.join(", ")}` };
  }
  if (c.actions !== undefined && fresh.length !== c.actions) {
    return { ok: false, why: `${fresh.length} actions (${fresh.map((a) => `"${a.text}"`).join(", ")}), expected ${c.actions}` };
  }
  const missing = (c.actionLike ?? []).filter((re) => !fresh.some((a) => re.test(a.text)));
  if (missing.length) return { ok: false, why: `no action like ${missing.join(" ")}` };
  return { ok: true };
}

async function live(c: Case): Promise<SimpleSortItem[] | null> {
  const res = await fetch(`${TARGET}/api/sort`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: c.raw, threads, actions, sortVersion: 2, captureId: `eval-${Math.random().toString(36).slice(2)}`, tzOffset: new Date().getTimezoneOffset() }),
  });
  const value = await res.json().catch(() => null) as { sort?: { items?: SimpleSortItem[] } } | null;
  return res.ok ? value?.sort?.items ?? null : null;
}

/** What a right answer looks like, built from the labels, through the real checker. */
function ideal(c: Case): SimpleSortItem[] {
  const parts = c.threads ?? [];
  const raw = { items: [
    ...parts.map((id, i) => ({ kind: "thought", text: parts.length > 1 ? `part ${i}` : c.raw, threadId: id, newThread: null, due: null, sameAsAction: null })),
    ...Array.from({ length: c.actions ?? 0 }, (_, i) => ({ kind: "action", text: c.actionLike?.[i]?.source.replace(/[.*\\]/g, "") ?? `task ${i}`, threadId: null, newThread: null, due: null, sameAsAction: null })),
    ...(!parts.length && !c.actions ? [{ kind: "thought", text: c.raw, threadId: "health", newThread: null, due: null, sameAsAction: null }] : []),
  ] };
  return normalizeSimpleSort(raw, { threads, actions, raw: c.raw });
}

it("sorter files thoughts the way the person means", async () => {
  // The scorer must pass ideal answers and catch a copy into two Threads.
  for (const c of cases) expect(score(c, ideal(c)), c.raw).toEqual({ ok: true });
  const copied: SimpleSortItem[] = [
    { kind: "thought", text: cases[0].raw, threads: [{ id: "reality" }] },
    { kind: "thought", text: cases[0].raw, threads: [{ id: "capture" }] },
  ];
  expect(score(cases[0], copied).ok).toBe(false);
  if (!TARGET) {
    console.log("\nSort eval: scorer verified on ideal and copied answers. Set CAPTURE_EVAL_TARGET to score a live model.");
    return;
  }
  const url = new URL(TARGET);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !(url.protocol === "https:" && url.hostname.endsWith(".vercel.app"))) {
    throw new Error("CAPTURE_EVAL_TARGET must be localhost or an https *.vercel.app preview");
  }
  const runs: { raw: string; step: string; ok: boolean; why?: string; items: SimpleSortItem[] | null }[][] = [];
  for (let r = 0; r < RUNS; r++) {
    const run = [];
    for (const c of cases) {
      const items = await live(c).catch(() => null);
      run.push({ raw: c.raw, step: c.step, items, ...score(c, items) });
    }
    runs.push(run);
  }
  const line = (step: string) => {
    const all = runs.flat().filter((r) => r.step === step);
    return `${all.filter((r) => r.ok).length}/${all.length}`;
  };
  console.log([
    `\n── Sort eval — ${TARGET} (${RUNS} run${RUNS === 1 ? "" : "s"}) ──`,
    `Step 1  one thread per thought, "only in X"   ${line("1")}`,
    `Step 2  own tasks out of long thoughts         ${line("2")}`,
    `Guard   must not regress                       ${line("-")}`,
    ...[...new Set(runs.flat().filter((r) => !r.ok).map((r) => `  ✗ [${r.step}] ${r.raw.slice(0, 70)}… — ${r.why}`))],
  ].join("\n"));
  mkdirSync("outputs/eval-sort", { recursive: true });
  const out = `outputs/eval-sort/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify({ target: TARGET, runs }, null, 2));
  console.log(`Written: ${out}`);
}, 30 * 60_000);
