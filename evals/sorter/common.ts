import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Board } from "@/lib/model";
import { EVAL_HOME } from "./tier";

export type Case = { id: string; raw: string; at: number; set: string; expect?: string };
export type Result = Case & { threads?: string[]; kinds?: string[]; right?: boolean; tasks?: string[]; error?: string };

export const loadBoard = () =>
  JSON.parse(readFileSync(path.join(EVAL_HOME, "cases", "board.json"), "utf8")).board as Board;

/** A small sample per group unless CAPTURE_EVAL_ALL=1: iterate small, run
 * everything once at the end. */
export function loadCases(file: string): Case[] {
  const all = JSON.parse(readFileSync(path.join(EVAL_HOME, "cases", file), "utf8")) as Case[];
  if (process.env.CAPTURE_EVAL_ALL === "1") return all;
  const per = Number(process.env.CAPTURE_EVAL_PER_SET) || 10;
  const sets = [...new Set(all.map((c) => c.set))];
  return sets.flatMap((set) => all.filter((c) => c.set === set).slice(0, per));
}

/** The board as it was when this capture was made: later notes, later
 * actions and the capture's own note are left out, so it cannot see itself. */
export function boardAt(board: Board, c: Case): Board {
  const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);
  return {
    ...board,
    threads: board.threads.map((t) => ({ ...t, frags: t.frags.filter((f) => f.at < c.at && key(f.text) !== key(c.raw)) })),
    actions: board.actions.filter((a) => (a.at ?? 0) < c.at),
  };
}

export function save(name: string, results: unknown) {
  const dir = path.join(EVAL_HOME, "results");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(results, null, 1));
  return file;
}
