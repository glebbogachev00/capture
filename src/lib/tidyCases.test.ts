/**
 * Tidy use-case suite — five realistic boards, one source of truth
 * (tidyCases.json), two consumers: these deterministic tests and the live
 * probe (scripts/probe-tidy-cases.mjs).
 *
 * What each case proves:
 *   c1 semantic merge  — the local word-match scan stays silent (the pair
 *                       shares zero content words); only the model sees the
 *                       same idea and merges the fragment across threads.
 *   c2 extract task    — the vet note is lifted out as an action; the
 *                       reflection about Luna is NOT, nor is the faucet note.
 *   c3 duplicate       — both passes find the same task twice and both name
 *                       the NEWER capture as the copy, so the pair collapses
 *                       to one row and the original is never at risk.
 *   c4 move + fold     — the oat-milk note moves to Groceries, the
 *                       water-filter action folds into the kitchen thread,
 *                       and the single-fragment groceries thread is never a
 *                       move source (no reverse move).
 *   c5 clean silence   — nothing is proposed; a rogue whole-thread merge is
 *                       refused even if the model emits it.
 */

import { describe, expect, it } from "vitest";
import cases from "./tidyCases.json";

/**
 * These boards were written with symbolic timestamps (at: 200, 1000), and
 * every fixture action is shelf "keep". Judged against the real clock they
 * are all decades old, so the get-light claim fires on every one of them
 * and drowns the clutter claims these cases exist to pin. The scan is given
 * the fixtures' own era instead: staleness has its own tests.
 */
const FIXTURE_NOW = 10_000;
import type { Action, Board, Frag, Intention, Thread } from "./model";
import { scanBoard, type OrganizeKind, type OrganizeProposal } from "./organize";
import {
  mapAiProposals,
  mergeOrganize,
  type RawAiProposal,
  type TidySnapshot,
} from "./organizeAi";

type TidyCase = {
  id: string;
  name: string;
  blurb: string;
  localExpect: OrganizeKind[];
  aiExpect: OrganizeKind[];
  aiForbid: OrganizeKind[];
  soft: OrganizeKind[];
  silence: boolean;
  cannedAi: RawAiProposal[];
  board: TidySnapshot;
};

const CASES = cases as unknown as TidyCase[];

/* ------------------------------ builders ------------------------------ */

const snapshotToBoard = (s: TidySnapshot): Board => ({
  actions: s.actions.map(
    (a): Action => ({
      id: a.id,
      text: a.text,
      done: false,
      at: a.at,
      shelf: "keep",
      expires: null,
      ...(a.src ? { src: a.src } : {}),
    })
  ),
  threads: s.threads.map(
    (t): Thread => ({
      id: t.id,
      name: t.name,
      summary: t.summary ?? "",
      frags: t.frags.map((f): Frag => ({ id: f.id, at: f.at, text: f.text })),
    })
  ),
  intentions: s.intentions.map(
    (i, n): Intention => ({
      id: i.id,
      number: n + 1,
      rawInput: i.expanded,
      expandedIntention: i.expanded,
      recommendedActions: [],
      counterIntentions: [],
      at: 1,
      updatedAt: 1,
    })
  ),
  principles: [],
  ledger: [],
  corrections: [],
});

const kinds = (ps: OrganizeProposal[]) => [...new Set(ps.map((p) => p.kind))];

const byId = (id: string) => CASES.find((c) => c.id === id)!;

/* ------------------- the local scan, per use case ------------------- */

describe("Tidy use cases — the deterministic local scan", () => {
  it.each(CASES.map((c) => [c.id, c] as const))(
    "%s: proposes exactly the expected kinds (no more, no less)",
    (_id, tc) => {
      const board = snapshotToBoard(tc.board);
      const got = kinds(scanBoard(board, [], FIXTURE_NOW)).sort();
      expect(got).toEqual([...tc.localExpect].sort());
    }
  );

  it("c1: the semantic pair shares zero content words — local must be silent", () => {
    const board = snapshotToBoard(byId("c1-semantic-merge").board);
    expect(scanBoard(board, [], FIXTURE_NOW)).toEqual([]);
  });

  it("c2: the extract names the task fragment (f1), never the reflection (f2) or the faucet note", () => {
    const board = snapshotToBoard(byId("c2-extract-task").board);
    const extract = scanBoard(board, [], FIXTURE_NOW).find((p) => p.kind === "extract_action")!;
    expect(extract).toBeDefined();
    expect(extract.sourceFragId).toBe("f1");
    expect(extract.sourceName).toContain("call the vet");
  });

  it("c3: the action duplicate names the NEWER capture as the copy, the original stays", () => {
    const board = snapshotToBoard(byId("c3-duplicate-action").board);
    const dup = scanBoard(board, [], FIXTURE_NOW).find((p) => p.kind === "dup_action")!;
    expect(dup.sourceId).toBe("a-new"); // at 300 — the copy
    expect(dup.targetId).toBe("a-old"); // at 100 — the original kept
    expect(dup.reason).toContain("dentist appointment");
  });

  it("c3: the pasted-twice fragment duplicate names the NEWER fragment as the copy, in the same thread", () => {
    const board = snapshotToBoard(byId("c3-duplicate-action").board);
    const dup = scanBoard(board, [], FIXTURE_NOW).find((p) => p.kind === "dup_fragment")!;
    expect(dup).toBeDefined();
    expect(dup.sourceFragId).toBe("f2"); // at 110 — the copy
    expect(dup.sourceThreadId).toBe("t-general");
    expect(dup.targetId).toBe("t-general"); // same thread — the original stays
    expect(dup.reason).toContain("lease renewal form");
  });

  it("c4: move targets the groceries thread and fold targets the kitchen thread", () => {
    const board = snapshotToBoard(byId("c4-move-and-fold").board);
    const ps = scanBoard(board, [], FIXTURE_NOW);
    const move = ps.find((p) => p.kind === "move_fragment")!;
    const fold = ps.find((p) => p.kind === "fold_action")!;
    expect(move.sourceFragId).toBe("f5");
    expect(move.targetId).toBe("t-groceries");
    expect(fold.sourceId).toBe("a1");
    expect(fold.targetId).toBe("t-kitchen");
  });

  it("c4: the single-fragment groceries thread is never a move source — no reverse move", () => {
    const board = snapshotToBoard(byId("c4-move-and-fold").board);
    const moves = scanBoard(board, [], FIXTURE_NOW).filter((p) => p.kind === "move_fragment");
    expect(moves).toHaveLength(1);
    expect(moves[0].sourceId).toBe("t-career");
  });

  it("c5: a clean board gets nothing at all", () => {
    const board = snapshotToBoard(byId("c5-clean-silence").board);
    expect(scanBoard(board, [], FIXTURE_NOW)).toEqual([]);
  });

  it("c6: the local scan never folds an action back into the thread its note came from", () => {
    /* extract_action leaves the note in the thread; the extracted action's
       src is that verbatim note. Folding it back would copy the note a
       second time — the scan must stay silent. */
    const board = snapshotToBoard(byId("c6-fold-back").board);
    expect(scanBoard(board, [], FIXTURE_NOW).filter((p) => p.kind === "fold_action")).toEqual([]);
  });
});

/* ----------------- the model pass, per use case (canned) ----------------- */

describe("Tidy use cases — the model pass maps canned answers correctly", () => {
  it.each(
    CASES.filter((c) => c.aiExpect.length || c.silence).map((c) => [c.id, c] as const)
  )("%s: the canned answer maps to exactly the expected kinds", (_id, tc) => {
    const snapshot = tc.board;
    const out = mapAiProposals(snapshot, tc.cannedAi);
    expect(kinds(out).sort()).toEqual([...tc.aiExpect].sort());
    if (tc.aiExpect.length) {
      expect(out.every((p) => p.origin === "ai")).toBe(true);
      expect(out.every((p) => p.id.startsWith("ai:"))).toBe(true);
    }
  });

  it("c1: the semantic merge maps the espresso note onto the morning-routine thread", () => {
    const out = mapAiProposals(byId("c1-semantic-merge").board, byId("c1-semantic-merge").cannedAi);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("merge_fragments");
    expect(out[0].sourceFragId).toBe("f3");
    expect(out[0].sourceThreadId).toBe("t-coffee");
    expect(out[0].targetId).toBe("t-morning");
    expect(out[0].verb).toBe("Merge");
  });

  it("c3: a REVERSED duplicate (model names the older copy first) is normalised — newer is always the source", () => {
    const tc = byId("c3-duplicate-action");
    const reversed: RawAiProposal[] = [
      {
        kind: "dup_action",
        confidence: "high",
        sourceId: "a-old", // model got the direction backwards
        targetId: "a-new",
        reason: "same task",
      },
    ];
    const out = mapAiProposals(tc.board, reversed);
    expect(out).toHaveLength(1);
    expect(out[0].sourceId).toBe("a-new"); // newer
    expect(out[0].targetId).toBe("a-old"); // original kept
    expect(out[0].id).toBe("ai:dup_action:a-new::a-old");
  });

  it("c6: the AI pass refuses the canned fold-back proposal", () => {
    const tc = byId("c6-fold-back");
    expect(mapAiProposals(tc.board, tc.cannedAi)).toEqual([]);
  });

  it("c5: a rogue whole-thread merge is refused even on a clean board", () => {
    const tc = byId("c5-clean-silence");
    const rogue = [
      {
        kind: "merge_threads",
        confidence: "high",
        sourceId: "t-books",
        targetId: "t-music",
        reason: "both about enjoying things",
      },
    ] as unknown as RawAiProposal[];
    expect(mapAiProposals(tc.board, rogue)).toEqual([]);
  });

  it("c5: the silence guard lives in the PROMPT — a valid-id same-topic merge WOULD map, and that is pinned here", () => {
    /* Books and Music have nothing in common; a model that proposed a
       merge anyway would name real ids, and the MAPPER cannot be expected
       to judge taste — refusing same-topic merges is the prompt's job,
       which the live probe checks (c5 silence). This pins the mapping
       side explicitly so nobody "fixes" the mapper later and breaks it. */
    const tc = byId("c5-clean-silence");
    const merge = [
      {
        kind: "merge_fragments",
        confidence: "medium",
        sourceId: "t-books",
        sourceFragId: "f1",
        targetId: "t-music",
        reason: "both are leisure notes",
      },
    ] as RawAiProposal[];
    const out = mapAiProposals(tc.board, merge);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("merge_fragments");
  });
});

/* -------------------- the merged review list per case -------------------- */

describe("Tidy use cases — the merged review list", () => {
  it("merges local + AI claims for a case where both fire, without duplication", () => {
    const tc = byId("c3-duplicate-action");
    const merged = mergeOrganize(
      mapAiProposals(tc.board, tc.cannedAi),
      scanBoard(snapshotToBoard(tc.board))
    );
    const dups = merged.filter((p) => p.kind === "dup_action");
    expect(dups).toHaveLength(1); // the pair from both passes collapses
    expect(dups[0].origin).toBe("ai"); // the semantic version wins
  });

  it("stays silent for the clean board after the merge too", () => {
    const tc = byId("c5-clean-silence");
    const merged = mergeOrganize(
      mapAiProposals(tc.board, tc.cannedAi),
      scanBoard(snapshotToBoard(tc.board), [], FIXTURE_NOW)
    );
    expect(merged).toEqual([]);
  });

  it("every proposal across all five cases names ids that exist in its board", () => {
    for (const tc of CASES) {
      const known = new Set<string>([
        ...tc.board.actions.map((a) => a.id),
        ...tc.board.threads.map((t) => t.id),
        ...tc.board.threads.flatMap((t) => t.frags.map((f) => f.id)),
        ...tc.board.intentions.map((i) => i.id),
      ]);
      const merged = mergeOrganize(
        mapAiProposals(tc.board, tc.cannedAi),
        scanBoard(snapshotToBoard(tc.board))
      );
      for (const p of merged) {
        expect(known.has(p.sourceId), `${tc.id}: source ${p.sourceId}`).toBe(true);
        expect(known.has(p.targetId), `${tc.id}: target ${p.targetId}`).toBe(true);
        if (p.sourceFragId) {
          expect(known.has(p.sourceFragId), `${tc.id}: frag ${p.sourceFragId}`).toBe(true);
        }
      }
    }
  });
});

/* ------------------ the EMPTY reference stays meaningful ------------------ */

describe("sanity", () => {
  it("the case file covers every proposal kind the engine can emit — positively, not just as a forbidden kind", () => {
    const positive = new Set<OrganizeKind>(
      CASES.flatMap((c) => [...c.localExpect, ...c.aiExpect])
    );
    for (const k of [
      "merge_fragments",
      "dup_action",
      "dup_fragment",
      "fold_action",
      "move_fragment",
      "extract_action",
    ] as OrganizeKind[]) {
      expect(positive.has(k), `${k} is expected in at least one case`).toBe(true);
    }
  });

  it("every expectation string in every case is a real kind — a typo'd kind can never pass silently", () => {
    /* The six kinds the engine can actually emit. Positive expectations
       (local/ai/soft/canned) must always be one of these. */
    const ENGINE = new Set<OrganizeKind>([
      "merge_fragments",
      "dup_action",
      "dup_fragment",
      "fold_action",
      "move_fragment",
      "extract_action",
    ]);
    /* aiForbid may also carry merge_threads — the product rule: the engine
       can never emit it, but forbidding it guards against a future
       re-introduction, so it is a meaningful forbidden value. */
    const FORBID = new Set<string>([...ENGINE, "merge_threads"]);
    for (const tc of CASES) {
      for (const k of tc.localExpect) {
        expect(ENGINE.has(k), `${tc.id}: unknown expected kind "${k}"`).toBe(true);
      }
      for (const k of [...tc.aiExpect, ...tc.soft]) {
        expect(ENGINE.has(k), `${tc.id}: unknown expected kind "${k}"`).toBe(true);
      }
      for (const k of tc.aiForbid) {
        expect(FORBID.has(k), `${tc.id}: unknown forbidden kind "${k}"`).toBe(true);
      }
      for (const p of tc.cannedAi) {
        expect(ENGINE.has(p.kind), `${tc.id}: unknown canned kind "${p.kind}"`).toBe(true);
      }
    }
  });

  it("the case file is wired to a real board model", () => {
    // A trivial exercise of snapshotToBoard: the conversion must produce a
    // structurally complete Board, so the cases can never silently drift
    // from the type the local scan consumes.
    const b = snapshotToBoard({ actions: [], threads: [], intentions: [] });
    expect(b).toEqual({
      actions: [],
      threads: [],
      intentions: [],
      principles: [],
      ledger: [],
      corrections: [],
    });
  });
});
