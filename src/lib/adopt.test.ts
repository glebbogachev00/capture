import { describe, expect, it } from "vitest";
import { adoptHubState } from "./adopt";
import { EMPTY, type Board } from "./model";
import type { SyncState } from "./sync";

/**
 * The adoption rules, as behavior — with fixtures in the vocabulary this
 * board actually holds, because clean invented fixtures have hidden real
 * failures before.
 */

const act = (id: string, text: string, updatedAt: number) =>
  ({ id, text, done: false, at: updatedAt, updatedAt }) as never;

const state = (board: Partial<Board>, tombstones: never[] = []): SyncState => ({
  board: { ...EMPTY, ...board } as Board,
  tombstones,
});

describe("adopting the hub's copy", () => {
  it("a capture made while the request was in flight survives the reply", () => {
    /* The reply is a snapshot from before this capture existed. Newest-wins
       per item must keep it — adopting wholesale would let a 1.2s round
       trip eat a thought. */
    const local = state({
      actions: [act("mid", "Upload the Tuff T. book into Hermes", 2000)],
    });
    const remote = state({ actions: [] });
    const out = adoptHubState(local, remote);
    expect(out.board.actions.map((a) => a.id)).toContain("mid");
  });

  it("the other device's additions arrive, with a sentence about them", () => {
    const local = state({ actions: [act("a1", "Prepare the one-to-one class", 100)] });
    const remote = state({
      actions: [
        act("a1", "Prepare the one-to-one class", 100),
        act("a2", "Sketch the mobile agent dashboard flow", 200),
      ],
    });
    const out = adoptHubState(local, remote);
    expect(out.changed).toBe(true);
    expect(out.board.actions).toHaveLength(2);
    expect(out.note).toBeTruthy();
  });

  it("adopting what you already hold changes nothing and says nothing", () => {
    const both = state({
      actions: [act("a1", "Fix the mis-sorting of notes in Capture", 100)],
    });
    const out = adoptHubState(both, both);
    expect(out.changed).toBe(false);
    expect(out.note).toBeNull();
  });

  it("a local edit fresher than the hub's copy wins item-by-item", () => {
    /* The shipped incident: the cheap "is the newest incoming thing newer
       than mine" test dropped real edits whenever ANY local item was
       fresher. Item-by-item, the older remote wording loses only its own
       slot. */
    const local = state({
      actions: [
        act("a1", "Fix the banner so layers turn into actions reliably", 300),
        act("a2", "Old wording here", 100),
      ],
    });
    const remote = state({
      actions: [
        act("a1", "Fix the banner", 100),
        act("a2", "Newer wording from the laptop", 200),
      ],
    });
    const out = adoptHubState(local, remote);
    const byId = Object.fromEntries(out.board.actions.map((a) => [a.id, a.text]));
    expect(byId["a1"]).toBe("Fix the banner so layers turn into actions reliably");
    expect(byId["a2"]).toBe("Newer wording from the laptop");
    expect(out.changed).toBe(true);
  });

  it("an edit alone arrives silently — the note is for additions", () => {
    const local = state({ actions: [act("a1", "Old wording", 100)] });
    const remote = state({ actions: [act("a1", "New wording from the laptop", 200)] });
    const out = adoptHubState(local, remote);
    expect(out.changed).toBe(true);
    expect(out.note).toBeNull();
  });

  it("the adopted board carries every field the Board declares", () => {
    /* The five-times-shipped class, guarded at this seam too. */
    const local = state({
      wraps: [{ day: "2026-08-29", text: "yesterday, in short", at: 5 }] as never,
      completions: [{ id: "c1", at: 6 }] as never,
      historyEpoch: 2,
    });
    const out = adoptHubState(local, state({}));
    const bag = out.board as unknown as Record<string, unknown>;
    for (const key of Object.keys(EMPTY)) {
      expect(bag[key], `adoption dropped Board.${key}`).toBeDefined();
    }
    expect(out.board.wraps).toHaveLength(1);
    expect(out.board.completions).toHaveLength(1);
    expect(out.board.historyEpoch).toBe(2);
  });
});
