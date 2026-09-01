import { describe, expect, it } from "vitest";
import type { Action, Board, Frag, Thread } from "./model";
import { EMPTY } from "./model";
import { HIGH_CAP, MEDIUM_CAP, scanBoard } from "./organize";
import {
  compactBoard,
  mapAiProposals,
  mergeOrganize,
  renderBoardForPrompt,
  SNAPSHOT_CAPS,
  type RawAiProposal,
} from "./organizeAi";

/* ------------------------------ builders ------------------------------ */

const act = (id: string, text: string, src?: string): Action => ({
  id,
  text,
  done: false,
  at: 100,
  shelf: "keep",
  expires: null,
  ...(src ? { src } : {}),
});

const frag = (id: string, text: string): Frag => ({ id, at: 100, text });

const thread = (id: string, name: string, frags: Frag[]): Thread => ({
  id,
  name,
  summary: "",
  frags,
});

const board = (b: Partial<Board>): Board => ({ ...EMPTY, ...b });

/* ---------------------------- compactBoard ---------------------------- */

describe("compactBoard", () => {
  it("keeps ids and text for the model to reference", () => {
    const b = board({
      actions: [act("a1", "Call the vet")],
      threads: [thread("t1", "Coffee", [frag("f1", "cold brew experiments")])],
      intentions: [
        {
          id: "i1",
          number: 1,
          rawInput: "i want light",
          expandedIntention: "I live somewhere with light",
          recommendedActions: [],
          counterIntentions: [],
          at: 1,
          updatedAt: 1,
        },
      ],
    });
    const s = compactBoard(b);
    expect(s.actions).toEqual([{ id: "a1", text: "Call the vet", at: 100 }]);
    expect(s.threads[0]).toMatchObject({
      id: "t1",
      name: "Coffee",
      frags: [{ id: "f1", text: "cold brew experiments", at: 100 }],
    });
    expect(s.intentions[0]).toMatchObject({ id: "i1", expanded: "I live somewhere with light" });
  });

  it("caps a huge board so one prompt stays small", () => {
    const actions = Array.from({ length: SNAPSHOT_CAPS.actions + 5 }, (_, i) =>
      act("a" + i, "task number " + i)
    );
    const threads = Array.from({ length: SNAPSHOT_CAPS.threads + 5 }, (_, i) =>
      thread(
        "t" + i,
        "thread " + i,
        Array.from({ length: SNAPSHOT_CAPS.fragsPerThread + 3 }, (_, j) =>
          frag("f" + i + "-" + j, "note " + j)
        )
      )
    );
    const s = compactBoard(board({ actions, threads }));
    expect(s.actions).toHaveLength(SNAPSHOT_CAPS.actions);
    expect(s.threads).toHaveLength(SNAPSHOT_CAPS.threads);
    expect(s.threads[0].frags).toHaveLength(SNAPSHOT_CAPS.fragsPerThread);
  });

  it("clips long text so no single item dominates", () => {
    const long = "x".repeat(500);
    const s = compactBoard(board({ threads: [thread("t1", "N", [frag("f1", long)])] }));
    expect(s.threads[0].frags[0].text.length).toBeLessThan(250);
  });
});

/* --------------------------- renderBoardForPrompt --------------------------- */

describe("renderBoardForPrompt", () => {
  it("renders ids inline so the model can cite them exactly", () => {
    const s = compactBoard(
      board({
        actions: [act("a1", "Call the vet")],
        threads: [thread("t1", "Coffee", [frag("f1", "cold brew")])],
        intentions: [
          {
            id: "i1",
            number: 1,
            rawInput: "light",
            expandedIntention: "I live somewhere with light",
            recommendedActions: [],
            counterIntentions: [],
            at: 1,
            updatedAt: 1,
          },
        ],
      })
    );
    const out = renderBoardForPrompt(s);
    expect(out).toContain("[a1]");
    expect(out).toContain("[t1]");
    expect(out).toContain("[f1]");
    expect(out).toContain("[i1]");
  });
});

/* ----------------------------- mapAiProposals ----------------------------- */

const snapshot = () =>
  compactBoard(
    board({
      actions: [act("a1", "Book a dentist appointment"), act("a2", "Buy milk")],
      threads: [
        thread("t1", "Coffee", [frag("f1", "cold brew experiments"), frag("f2", "espresso machine notes")]),
        thread("t2", "Vet", [frag("f3", "Luna shots schedule")]),
      ],
    })
  );

describe("mapAiProposals — validation", () => {
  it("drops proposals referencing ids that do not exist (hallucination)", () => {
    const raw: RawAiProposal[] = [
      {
        kind: "merge_fragments",
        confidence: "high",
        sourceId: "t1",
        sourceFragId: "f1",
        targetId: "no-such-thread",
        reason: "same idea",
      },
      {
        kind: "dup_action",
        confidence: "high",
        sourceId: "ghost-action",
        targetId: "a1",
        reason: "same task",
      },
      {
        kind: "extract_action",
        confidence: "medium",
        sourceId: "t1",
        sourceFragId: "f99",
        targetId: "t1",
        reason: "a task",
      },
    ];
    expect(mapAiProposals(snapshot(), raw)).toEqual([]);
  });

  it("requires fragment kinds to name a thread that actually holds the fragment", () => {
    const raw: RawAiProposal[] = [
      {
        kind: "move_fragment",
        confidence: "high",
        sourceId: "t2",
        sourceFragId: "f1", // f1 lives in t1, not t2
        targetId: "t1",
        reason: "belongs elsewhere",
      },
    ];
    expect(mapAiProposals(snapshot(), raw)).toEqual([]);
  });

  it("move_fragment must land in a real, different thread — a hallucinated target is dropped", () => {
    const raw: RawAiProposal[] = [
      {
        kind: "move_fragment",
        confidence: "high",
        sourceId: "t1",
        sourceFragId: "f1",
        targetId: "ghost-thread",
        reason: "belongs elsewhere",
      },
    ];
    expect(mapAiProposals(snapshot(), raw)).toEqual([]);
  });

  it("extract_action normalises its target to the source thread — a stable ai: id", () => {
    /* The model may write any targetId for an extraction; the mapped
       proposal must not carry it, or the deterministic id would change
       run to run and a dismissal would stop sticking. */
    const raw = [
      {
        kind: "extract_action",
        confidence: "medium",
        sourceId: "t1",
        sourceFragId: "f1",
        targetId: "whatever-the-model-said",
        reason: "a task",
      },
    ] as RawAiProposal[];
    const out = mapAiProposals(snapshot(), raw);
    expect(out).toHaveLength(1);
    expect(out[0].targetId).toBe("t1");
    expect(out[0].id).toBe("ai:extract_action:t1:f1:t1");
  });

  it("merge_fragments must point at a different thread", () => {
    const raw: RawAiProposal[] = [
      {
        kind: "merge_fragments",
        confidence: "high",
        sourceId: "t1",
        sourceFragId: "f1",
        targetId: "t1", // same thread — moving is meaningless
        reason: "same idea",
      },
    ];
    expect(mapAiProposals(snapshot(), raw)).toEqual([]);
  });

  it("refuses merge_threads — the product rule, enforced even if the model disobeys", () => {
    /* The type can't even express a whole-thread merge (merge_threads was
       removed from OrganizeKind), so this simulates a rogue model by
       forcing the kind through. mapAiProposals must refuse it at runtime. */
    const raw = [
      {
        kind: "merge_threads",
        confidence: "high",
        sourceId: "t1",
        targetId: "t2",
        reason: "same ground",
      },
    ] as unknown as RawAiProposal[];
    expect(mapAiProposals(snapshot(), raw)).toEqual([]);
  });

  it("dedupes the same pair proposed twice", () => {
    const same: RawAiProposal = {
      kind: "dup_action",
      confidence: "high",
      sourceId: "a1",
      targetId: "a2",
      reason: "same task",
    };
    const out = mapAiProposals(snapshot(), [same, { ...same }]);
    expect(out).toHaveLength(1);
  });
});

describe("mapAiProposals — mapping", () => {
  it("maps a valid merge_fragments into the OrganizeProposal shape", () => {
    const out = mapAiProposals(snapshot(), [
      {
        kind: "merge_fragments",
        confidence: "high",
        sourceId: "t2",
        sourceFragId: "f3",
        targetId: "t1",
        reason: "Both notes are really about the espresso routine.",
      },
    ]);
    expect(out).toHaveLength(1);
    const p = out[0];
    expect(p.kind).toBe("merge_fragments");
    expect(p.origin).toBe("ai");
    expect(p.verb).toBe("Merge");
    expect(p.sourceThreadId).toBe("t2");
    expect(p.sourceFragId).toBe("f3");
    expect(p.targetId).toBe("t1");
    expect(p.sourceName).toContain("Luna shots");
    expect(p.reason).toContain("espresso routine");
    expect(p.id).toBe("ai:merge_fragments:t2:f3:t1");
  });

  it("normalises dup_action direction — the newer copy is always the source, so both passes propose the same pair", () => {
    const b = board({
      actions: [
        { ...act("a1", "Book a dentist appointment for Tuesday"), at: 100 },
        { ...act("a2", "Book a dentist appointment for Friday"), at: 300 },
      ],
    });
    /* The model names the pair backwards (source = older). */
    const raw = [
      {
        kind: "dup_action",
        confidence: "high",
        sourceId: "a1",
        targetId: "a2",
        reason: "same task",
      },
    ] as RawAiProposal[];
    const out = mapAiProposals(compactBoard(b), raw);
    expect(out).toHaveLength(1);
    expect(out[0].sourceId).toBe("a2"); // newer
    expect(out[0].targetId).toBe("a1"); // original kept
    expect(out[0].id).toBe("ai:dup_action:a2::a1");
  });

  it("maps an extract_action with the thread as its home", () => {
    const out = mapAiProposals(snapshot(), [
      {
        kind: "extract_action",
        confidence: "medium",
        sourceId: "t1",
        sourceFragId: "f1",
        targetId: "t1",
        reason: "reads as a task",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].targetName).toBe("an action");
    expect(out[0].sourceThreadId).toBe("t1");
    expect(out[0].sourceFragId).toBe("f1");
  });

  it("is deterministic — same input, same ids", () => {
    const raw: RawAiProposal[] = [
      {
        kind: "dup_action",
        confidence: "high",
        sourceId: "a1",
        targetId: "a2",
        reason: "same task",
      },
      {
        kind: "fold_action",
        confidence: "medium",
        sourceId: "a1",
        targetId: "t1",
        reason: "belongs with the coffee notes",
      },
    ];
    const first = mapAiProposals(snapshot(), raw).map((p) => p.id);
    const second = mapAiProposals(snapshot(), raw).map((p) => p.id);
    expect(second).toEqual(first);
  });

  it("drops a fold_action whose target thread already holds the same note", () => {
    /* The extract→fold-back loop, AI side: the model proposes folding an
       action into the thread the note was extracted from — the thread
       already contains that exact fragment, so folding would duplicate it.
       The proposal is refused, never mapped. */
    const s = compactBoard(
      board({
        actions: [act("a1", "Find a way to deal with notes that are outdated")],
        threads: [
          thread("t1", "Bugs, Issues and Additions", [
            frag("f1", "Find a way to deal with notes that are outdated"),
          ]),
        ],
      })
    );
    const raw: RawAiProposal[] = [
      {
        kind: "fold_action",
        confidence: "high",
        sourceId: "a1",
        targetId: "t1",
        reason: "the action belongs with this thread",
      },
    ];
    expect(mapAiProposals(s, raw)).toEqual([]);
  });

  it("drops a fold-back even when the model's rewrite differs — src is the original note", () => {
    /* The real extraction case: extractAction rewrites the note into a clean
       task ("Audit existing notes…"), so the action TEXT differs from the
       fragment — but src is the verbatim note the thread already holds.
       The guard must see through the rewrite and refuse the fold. */
    const s = compactBoard(
      board({
        actions: [
          act(
            "a1",
            "Audit existing notes for outdated features",
            "Find a way to deal with notes that are outdated—example features I have already built"
          ),
        ],
        threads: [
          thread("t1", "Bugs, Issues and Additions", [
            frag(
              "f1",
              "Find a way to deal with notes that are outdated—example features I have already built"
            ),
          ]),
        ],
      })
    );
    const raw: RawAiProposal[] = [
      {
        kind: "fold_action",
        confidence: "high",
        sourceId: "a1",
        targetId: "t1",
        reason: "the action belongs with this thread",
      },
    ];
    expect(mapAiProposals(s, raw)).toEqual([]);
  });

  it("still maps a fold_action into a thread that does NOT hold the note", () => {
    const raw: RawAiProposal[] = [
      {
        kind: "fold_action",
        confidence: "medium",
        sourceId: "a2",
        targetId: "t2",
        reason: "belongs with the vet notes",
      },
    ];
    const out = mapAiProposals(snapshot(), raw);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("fold_action");
    expect(out[0].sourceId).toBe("a2");
    expect(out[0].targetId).toBe("t2");
  });

  it("caps strong claims first, medium behind them", () => {
    const actions = Array.from({ length: HIGH_CAP + 5 }, (_, i) => act("a" + i, "task " + i));
    const s = compactBoard(board({ actions }));
    const raw: RawAiProposal[] = [];
    for (let i = 0; i < HIGH_CAP + 5; i++) {
      raw.push({
        kind: "dup_action",
        confidence: "high",
        sourceId: "a" + i,
        targetId: "a" + (i + 1),
        reason: "same task",
      });
    }
    const out = mapAiProposals(s, raw);
    expect(out).toHaveLength(HIGH_CAP);
    expect(out.every((p) => p.confidence === "high")).toBe(true);
  });
});

/* ------------------------------- mergeOrganize ------------------------------- */

describe("mergeOrganize", () => {
  const ai: RawAiProposal[] = [
    {
      kind: "merge_fragments",
      confidence: "high",
      sourceId: "t1",
      sourceFragId: "f2",
      targetId: "t2",
      reason: "same idea",
    },
  ];
  it("merges AI claims first, local word-matches after", () => {
    const b = board({
      actions: [
        { ...act("new", "Book a dentist appointment for Tuesday"), at: 200 },
        { ...act("old", "Book a dentist appointment for Friday"), at: 100 },
      ],
      threads: [thread("t1", "Coffee", [frag("f1", "cold brew experiments")])],
    });
    const merged = mergeOrganize(mapAiProposals(snapshot(), ai), scanBoard(b));
    expect(merged.length).toBeGreaterThanOrEqual(2);
    expect(merged[0].origin).toBe("ai");
  });

  it("dedupes by PAIR — the same proposal from both passes appears once even though their ids differ", () => {
    const b = board({
      actions: [
        { ...act("a1", "Book a dentist appointment for Tuesday"), at: 200 },
        { ...act("a2", "Book a dentist appointment for Friday"), at: 100 },
      ],
    });
    const both: RawAiProposal[] = [
      {
        kind: "dup_action",
        confidence: "high",
        sourceId: "a1",
        targetId: "a2",
        reason: "same task",
      },
    ];
    /* Distinct at values make the local scan actually propose this pair —
       its id (dup_action:a1:a2) differs from the ai: id, so both would
       show unless mergeOrganize dedupes by pair. The AI version wins. */
    const merged = mergeOrganize(mapAiProposals(compactBoard(b), both), scanBoard(b));
    const dups = merged.filter((p) => p.kind === "dup_action");
    expect(dups).toHaveLength(1);
    expect(dups[0].origin).toBe("ai");
  });

  it("caps the merged list together", () => {
    const actions = Array.from({ length: MEDIUM_CAP + 3 }, (_, i) => act("a" + i, "task " + i));
    const s = compactBoard(board({ actions }));
    const raw: RawAiProposal[] = actions.map((a, i) => ({
      kind: "dup_action" as const,
      confidence: "medium" as const,
      sourceId: a.id,
      targetId: actions[(i + 1) % actions.length].id,
      reason: "same task",
    }));
    const merged = mergeOrganize(mapAiProposals(s, raw), []);
    expect(merged).toHaveLength(MEDIUM_CAP);
  });
});

describe("the same suggestion is never listed twice", () => {
  it("identifies a fragment proposal by its fragment, not its container", async () => {
    const { mergeOrganize } = await import("./organizeAi");
    const p = (over: object) =>
      ({
        id: "x",
        kind: "move_fragment",
        confidence: "high",
        verb: "Move",
        sourceId: "t-a",
        sourceFragId: "f1",
        sourceName: "Fix the signup bug",
        targetId: "t-launch",
        targetName: "Launch notes",
        reason: "r",
        score: 1,
        origin: "ai",
        ...over,
      }) as import("./organize").OrganizeProposal;
    /* Same fragment, same destination, disagreeing only about which thread
       currently holds it — one row, not two. */
    const out = mergeOrganize([p({})], [p({ sourceId: "t-b", origin: "local" })]);
    expect(out).toHaveLength(1);
  });
});

describe("a proposal with no fragment named", () => {
  /* The route's schema sends `sourceFragId: null` rather than omitting the
     key, because Groq rejects a response format whose properties are not
     all listed in `required` — it answered this route with a 400 on every
     call until the field became nullable. So null has to be as harmless
     here as absent was. */
  it("treats null the same as absent", () => {
    const board = {
      actions: [
        { id: "a1", text: "Renew the domain before Friday", at: 1 },
        { id: "a2", text: "Renew the domain before Friday", at: 2 },
      ],
      threads: [],
      intentions: [],
    };
    const withNull = mapAiProposals(board as never, [
      {
        kind: "dup_action",
        confidence: "high",
        sourceId: "a2",
        sourceFragId: null,
        targetId: "a1",
        reason: "Both say the same thing.",
      } as never,
    ]);
    const withAbsent = mapAiProposals(board as never, [
      {
        kind: "dup_action",
        confidence: "high",
        sourceId: "a2",
        targetId: "a1",
        reason: "Both say the same thing.",
      } as never,
    ]);
    expect(withNull).toHaveLength(withAbsent.length);
    expect(withNull.length).toBeGreaterThan(0);
  });
});

describe("mapAiProposals — looks_done (offered a tick, never ticked for)", () => {
  it("a real action with real cited evidence maps to a Tick off row", () => {
    const raw: RawAiProposal[] = [
      {
        kind: "looks_done",
        confidence: "high",
        sourceId: "a1",
        sourceFragId: null,
        targetId: "t2",
        reason: "a later Vet note says the appointment is booked",
      },
    ];
    const out = mapAiProposals(snapshot(), raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "looks_done",
      verb: "Tick off",
      sourceId: "a1",
      sourceName: "Book a dentist appointment",
      targetName: "Vet",
    });
  });

  it("a hallucinated action or a hallucinated evidence thread is dropped", () => {
    const raw: RawAiProposal[] = [
      {
        kind: "looks_done",
        confidence: "high",
        sourceId: "ghost-action",
        sourceFragId: null,
        targetId: "t2",
        reason: "says it happened",
      },
      {
        kind: "looks_done",
        confidence: "high",
        sourceId: "a1",
        sourceFragId: null,
        targetId: "no-such-thread",
        reason: "says it happened",
      },
    ];
    expect(mapAiProposals(snapshot(), raw)).toEqual([]);
  });
});
