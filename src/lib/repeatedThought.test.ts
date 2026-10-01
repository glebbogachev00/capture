import { describe, expect, it } from "vitest";
import { EMPTY, type Board, type Frag } from "./model";
import { repeatedThought } from "./repeatedThought";

const frag = (id: string, text: string): Frag => ({ id, at: 1, text, imgs: [] });
const board = (frags: Frag[]): Board => ({
  ...EMPTY,
  threads: [{ id: "rest", name: "Rest day planning", summary: "", frags }],
});
const older = frag("old", "On a rest day I want to walk, play a game, and avoid turning recovery into another productivity target.");

describe("repeatedThought", () => {
  it("offers to remove a thought that repeats one already in the thread", () => {
    const after = board([older, frag("new", "on a rest day I want to walk play a game and avoid turning recovery into another productivity target")]);
    expect(repeatedThought(board([older]), after, ["rest"])).toMatchObject({
      kind: "duplicate", targetId: "rest", sourceKind: "thread", sourceFragId: "new",
    });
  });

  it("catches a repeat contained in a longer older note", () => {
    const after = board([older, frag("new", "Avoid turning recovery into another productivity target.")]);
    expect(repeatedThought(board([older]), after, ["rest"])).toMatchObject({ sourceFragId: "new" });
  });

  it("does not treat shared words as a repeat", () => {
    const wish = frag("old", "I want an undo button");
    const after = board([wish, frag("new", "The undo button is in and working now")]);
    expect(repeatedThought(board([wish]), after, ["rest"])).toBeNull();
  });

  it("does not flag short fragments by containment", () => {
    const after = board([older, frag("new", "play a game")]);
    expect(repeatedThought(board([older]), after, ["rest"])).toBeNull();
  });
});
