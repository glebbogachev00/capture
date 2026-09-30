import { describe, expect, it } from "vitest";
import {
  applyOneLiners, oldPhotos, oneLinerContext, oneLiners, ONE_LINER_CONTEXT_MAX, readVerdicts, removePhotos,
} from "./cleanup";
import { mergeLedgers, type CaptureEntry } from "./ledger";
import { unreferencedImageIds } from "./imgSync";
import { EMPTY, type Action, type Board } from "./model";

const NOW = new Date(2026, 8, 30, 12).getTime();
const DAY = 864e5;
const act = (id: string, text: string, at: number, extra: Partial<Action> = {}): Action =>
  ({ id, text, at, done: false, shelf: "days", expires: null, ...extra });
const entry = (id: string, imgs: string[], kind: CaptureEntry["kind"] = "thread"): CaptureEntry =>
  ({ id, at: NOW - 60 * DAY, raw: "r", clean: "c", kind, source: "typed", targetId: "t", imgs });

const photoBoard = (): Board => ({
  ...EMPTY,
  threads: [
    { id: "t", name: "Kitchen", summary: "", cover: "img:old1", frags: [
      { id: "f1", text: "the old tap, before", at: NOW - 60 * DAY, imgs: ["old1"] },
      { id: "f2", text: "(image only)", at: NOW - 50 * DAY, imgs: ["old2"] },
      { id: "f3", text: "new tiles", at: NOW - DAY, imgs: ["new1"] },
    ] },
    { id: "u", name: "Only a photo", summary: "", frags: [{ id: "f4", text: "", at: NOW - 70 * DAY, imgs: ["old3"] }] },
  ],
  actions: [
    act("a1", "fix the tap", NOW - 40 * DAY, { shot: { threadId: "t", fragId: "f1" } }),
    act("a2", "pending thing", NOW - 90 * DAY, { unsorted: true, imgs: ["pend"] }),
  ],
  intentions: [{ id: "i", number: 1, rawInput: "x", expandedIntention: "X", recommendedActions: [], counterIntentions: [],
    imgs: ["old4"], at: NOW - 80 * DAY, updatedAt: NOW - 80 * DAY }],
  profile: { name: "G", imageId: "face" },
  ledger: [entry("l1", ["old1", "old2"]), entry("l2", ["pend"], "pending")],
});

describe("oldPhotos", () => {
  it("offers photos by age, never the profile picture or an unsorted capture's", () => {
    const month = oldPhotos(photoBoard(), NOW - 30 * DAY).map((p) => p.id);
    expect(month).toEqual(["old2", "old1", "old3", "old4"]);
    const all = oldPhotos(photoBoard(), Infinity).map((p) => p.id);
    expect(all).toContain("new1");
    expect(all).not.toContain("face");
    expect(all).not.toContain("pend");
  });

  it("dates a photo by its newest use", () => {
    const b = photoBoard();
    b.actions.push(act("a3", "reuse", NOW - DAY, { imgs: ["old1"] }));
    expect(oldPhotos(b, NOW - 30 * DAY).map((p) => p.id)).not.toContain("old1");
  });
});

describe("removePhotos", () => {
  it("takes the photos off, keeps the words, and lets the bytes go", () => {
    const before = photoBoard();
    const out = removePhotos(before, ["old1", "old2", "old3", "old4"], NOW)!;
    const t = out.board.threads.find((x) => x.id === "t")!;
    // The captioned note stays without its photo; the photo-only note goes.
    expect(t.frags.map((f) => [f.id, f.imgs])).toEqual([["f1", []], ["f3", ["new1"]]]);
    expect(t.cover).toBeUndefined();
    // A thread that was nothing but a photo goes with it.
    expect(out.board.threads.map((x) => x.id)).toEqual(["t"]);
    // The action no longer points at a photo that is gone.
    expect(out.board.actions.find((a) => a.id === "a1")!.shot).toBeUndefined();
    expect(out.board.intentions[0].imgs).toEqual([]);
    // Filed history lets go too; a pending capture's only copy is untouched.
    expect(out.board.ledger.find((e) => e.id === "l1")!.imgs).toEqual([]);
    expect(out.board.ledger.find((e) => e.id === "l2")!.imgs).toEqual(["pend"]);
    expect(unreferencedImageIds(out.board, out.imgs).sort()).toEqual(["old1", "old2", "old3", "old4"]);
    expect(out.notice).toBe("Removed 4 photos and 2 photo-only notes. The words stay.");
    // Everything else on the board survives the rebuild.
    expect(out.board.profile).toBe(before.profile);
    expect(out.board.principles).toBe(before.principles);
  });

  it("stays removed when another device's older copy of the record syncs back", () => {
    const stripped = removePhotos(photoBoard(), ["old1"], NOW)!.board.ledger;
    const hub = photoBoard().ledger;
    for (const merged of [mergeLedgers(stripped, hub), mergeLedgers(hub, stripped)]) {
      expect(merged.find((e) => e.id === "l1")!.imgs).toEqual(["old2"]);
      expect(merged.find((e) => e.id === "l2")!.imgs).toEqual(["pend"]);
    }
  });
});

const scrapBoard = (): Board => ({
  ...EMPTY,
  threads: [
    { id: "p", name: "Pricing", summary: "annual vs monthly", frags: [
      { id: "n1", text: "switch to annual billing at $8", at: NOW - 5 * DAY },
      { id: "n2", text: "annual billing", at: NOW - 4 * DAY },
      { id: "n3", text: "kitchen tiles arrive thursday", at: NOW - 3 * DAY },
      { id: "n4", text: "a long note\nover two lines", at: NOW - 2 * DAY },
    ] },
    { id: "k", name: "Kitchen", summary: "renovation", frags: [{ id: "n5", text: "order the grout", at: NOW - DAY }] },
    { id: "s", name: "Scrap", summary: "", frags: [{ id: "n6", text: "ok that", at: NOW - DAY }] },
  ],
  actions: [
    act("a1", "yeah and also", NOW - 2 * DAY),
    act("a2", "tiles are grey", NOW - 2 * DAY),
    act("a3", "done thing", NOW, { done: true }),
    act("a4", "faded thing", NOW, { faded: true }),
    act("a5", "unsorted thing", NOW, { unsorted: true }),
  ],
});

describe("oneLiners", () => {
  it("offers short single-line notes and open tasks, newest first, minus kept ones", () => {
    const keys = oneLiners(scrapBoard()).map((o) => o.key);
    expect(keys).toEqual(expect.arrayContaining(["n:n1", "n:n2", "n:n3", "n:n5", "n:n6", "a:a1", "a:a2"]));
    expect(keys).not.toContain("n:n4");
    expect(keys).not.toContain("a:a3");
    expect(keys).not.toContain("a:a4");
    expect(keys).not.toContain("a:a5");
    expect(oneLiners(scrapBoard(), new Set(["n:n6"])).map((o) => o.key)).not.toContain("n:n6");
  });
});

describe("readVerdicts", () => {
  const b = scrapBoard();
  const ctx = oneLinerContext(b, oneLiners(b), NOW);
  const ref = (key: string) => Object.entries(ctx.items).find(([, v]) => v.key === key)![0];
  const tref = (id: string) => Object.entries(ctx.threads).find(([, v]) => v.id === id)![0];

  it("labels the scraps and shows their neighbours", () => {
    expect(ctx.text).toContain("switch to annual billing at $8");
    expect(ctx.text).toContain(`[${ref("n:n6")}] (note in [${tref("s")}]`);
  });

  it("keeps only verdicts naming a real scrap and a real, different thread", () => {
    const out = readVerdicts({ changes: [
      { ref: ref("n:n2"), verdict: "remove", to: null, reason: "Repeats the note above." },
      { ref: ref("n:n3"), verdict: "move", to: tref("k"), reason: "About the kitchen." },
      { ref: ref("n:n1"), verdict: "move", to: tref("p"), reason: "Same thread." },
      { ref: ref("a:a2"), verdict: "move", to: "T99", reason: "Nowhere." },
      { ref: "L999", verdict: "remove", to: null, reason: "Invented." },
      { ref: ref("n:n2"), verdict: "remove", to: null, reason: "Twice." },
    ] }, ctx)!;
    expect(out.map((p) => [p.item.key, p.verdict, p.to?.id])).toEqual([
      ["n:n2", "remove", undefined],
      ["n:n3", "move", "k"],
    ]);
    expect(readVerdicts({ nope: true }, ctx)).toBeNull();
  });

  it("removes identical one-liners down to one copy, never to none", () => {
    const same = (id: string, at: number) => ({ id, at, text: "For Ovid, the tower still needs to match", imgs: [] });
    const board3: Board = { ...EMPTY, threads: [{ id: "ovid", name: "Ovid", summary: "", frags: [same("o1", 1), same("o2", 2), same("o3", 3)] }] };
    const c = oneLinerContext(board3, oneLiners(board3), NOW);
    const refOf = (key: string) => Object.entries(c.items).find(([, item]) => item.key === key)![0];
    const out = readVerdicts({ changes: ["n:o1", "n:o2", "n:o3"].map((key) => ({ ref: refOf(key), verdict: "remove", to: null, reason: "Repeats the note next to it." })) }, c)!;
    expect(out.map((p) => p.item.key).sort()).toEqual(["n:o2", "n:o3"]);
  });

  it("fits a very wide board inside the route's limit, scraps intact", () => {
    const wide: Board = { ...b, threads: [...b.threads, ...Array.from({ length: 600 }, (_, i) => ({
      id: `w${i}`, name: `Thread ${i}`, summary: "x".repeat(300), frags: [] }))] };
    const big = oneLinerContext(wide, oneLiners(wide), NOW);
    expect(big.text.length).toBeLessThanOrEqual(ONE_LINER_CONTEXT_MAX);
    expect(big.text).toContain("## One-liners to review");
    expect(big.text).toContain("ok that");
  });
});

describe("applyOneLiners", () => {
  const b = scrapBoard();
  const ctx = oneLinerContext(b, oneLiners(b), NOW);
  const item = (key: string) => Object.values(ctx.items).find((v) => v.key === key)!;
  let n = 0;
  const mkId = () => `new${n++}`;

  it("applies a batch in one change: delete, move, let go, file", () => {
    const out = applyOneLiners(b, [
      { item: item("n:n2"), verdict: "remove", reason: "" },
      { item: item("n:n6"), verdict: "remove", reason: "" },
      { item: item("n:n3"), verdict: "move", to: { id: "k", name: "Kitchen" }, reason: "" },
      { item: item("a:a1"), verdict: "remove", reason: "" },
      { item: item("a:a2"), verdict: "move", to: { id: "k", name: "Kitchen" }, reason: "" },
    ], NOW, mkId)!;
    const byId = (id: string) => out.board.threads.find((t) => t.id === id);
    expect(byId("p")!.frags.map((f) => f.id)).toEqual(["n1", "n4"]);
    expect(byId("s")).toBeUndefined();
    expect(byId("k")!.frags.map((f) => f.text)).toEqual(["kitchen tiles arrive thursday", "tiles are grey", "order the grout"]);
    // A let-go task fades — recoverable — instead of vanishing.
    expect(out.board.actions.find((a) => a.id === "a1")).toMatchObject({ faded: true, fadedAt: NOW });
    expect(out.board.actions.find((a) => a.id === "a2")).toBeUndefined();
    expect(out.threads.sort()).toEqual(["k", "p"]);
    expect(out.notice).toBe("One-liners: cleared 3, filed 2. Let-go actions wait in Faded for two weeks.");
  });

  it("skips a scrap that changed since it was reviewed", () => {
    const edited: Board = { ...b, actions: b.actions.map((a) => a.id === "a1" ? { ...a, text: "yeah and also call Sam" } : a) };
    expect(applyOneLiners(edited, [{ item: item("a:a1"), verdict: "remove", reason: "" }], NOW, mkId)).toBeNull();
  });
});
