/**
 * Build the sorter eval cases from a copy of the board (never the live hub):
 *   npx tsx --conditions=react-server evals/sorter/cases.mts [board.json]
 * Default board: ~/.capture-eval/cases/board.json. Cases hold the person's own
 * notes, so they live in ~/.capture-eval/cases, never in the repository.
 *
 *   filing: "refiled" (the person moved it; expect their thread) and
 *           "control" (filed to a thread and never touched)
 *   tasks:  "missed" (the person pulled a task out by hand: expect one) and
 *           "plain" (left as a note: expect none)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Board } from "@/lib/model";
import { EVAL_HOME } from "./tier";

const dir = path.join(EVAL_HOME, "cases");
const board = JSON.parse(readFileSync(process.argv[2] ?? path.join(dir, "board.json"), "utf8")).board as Board;
const key = (text?: string) => (text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 50);
const captures = new Map<string, Board["ledger"]>();
for (const entry of board.ledger) {
  if (entry.undone || entry.kind === "pending") continue;
  const id = entry.captureId ?? entry.id;
  captures.set(id, [...(captures.get(id) ?? []), entry]);
}
const firstSaid = (context: string) => board.ledger.filter((entry) => key(entry.raw) === key(context)).sort((a, b) => a.at - b.at)[0];
const corrections = board.corrections ?? [];
const touched = new Set(corrections.map((correction) => key(correction.context)));
const threadIds = new Set(board.threads.map((thread) => thread.id));

const refiled = corrections.flatMap((correction) => {
  const routing = correction.routing as { threadId?: string } | undefined;
  const said = correction.proposalKind === "refiled" && routing?.threadId && threadIds.has(routing.threadId) ? firstSaid(correction.context ?? "") : undefined;
  return said ? [{ id: `ref-${correction.id}`, raw: said.raw, at: said.at, expect: routing!.threadId!, set: "refiled" }] : [];
});
const untouched = [...captures.values()].filter((entries) => entries.every((entry) => entry.kind === "thread") &&
  !touched.has(key(entries[0].raw)) && entries[0].raw.split(/\s+/).length >= 12 && threadIds.has(entries[0].targetId ?? ""))
  .sort((a, b) => b[0].at - a[0].at);
const control = untouched.slice(0, 30).map((entries) => ({ id: `ctl-${entries[0].id}`, raw: entries[0].raw, at: entries[0].at, expect: entries[0].targetId!, set: "control" }));
const missed = corrections.flatMap((correction) => {
  const said = correction.proposalKind === "extract_action" ? firstSaid(correction.context ?? "") : undefined;
  return said ? [{ id: `ex-${correction.id}`, raw: said.raw, at: said.at, set: "missed" }] : [];
});
const plain = untouched.slice(30, 70).map((entries) => ({ id: `pl-${entries[0].id}`, raw: entries[0].raw, at: entries[0].at, set: "plain" }));

writeFileSync(path.join(dir, "filing-cases.json"), JSON.stringify([...refiled, ...control], null, 1));
writeFileSync(path.join(dir, "task-cases.json"), JSON.stringify([...missed, ...plain], null, 1));
console.log(`filing: ${refiled.length} refiled, ${control.length} control · tasks: ${missed.length} missed, ${plain.length} plain → ${dir}`);
