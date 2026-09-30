import { expect, it } from "vitest";
import type { Intention } from "./model";
import { intentionDisplayNumbers } from "./intentionDisplay";
import { EMPTY } from "./model";
import { shareableFor, shareIntentionList } from "./share";

it("numbers the current list newest to oldest without rewriting stored labels", () => {
  const intentions = [51, 49, 48, 47, 1, 46].map((number, index) => ({ id: `i${index}`, number }) as Intention);
  const before = JSON.stringify(intentions);
  const numbers = intentionDisplayNumbers(intentions);
  expect(intentions.map(item => numbers.get(item.id))).toEqual([6, 5, 4, 3, 2, 1]);
  expect(JSON.stringify(intentions)).toBe(before);
  expect(intentionDisplayNumbers(intentions.slice(1)).get("i1")).toBe(5);
});

it("uses the same current numbers in the current-view share and list export", () => {
  const a: Intention = { id: "a", number: 51, rawInput: "I rest.", expandedIntention: "I rest.", recommendedActions: [], counterIntentions: [], at: 2, updatedAt: 2 };
  const b: Intention = { ...a, id: "b", number: 1, at: 1 };
  const board = { ...EMPTY, intentions: [a, b] };
  expect(shareableFor(board, { kind: "intention", id: "a" }, 3)?.title).toBe("Intention 02");
  expect(shareIntentionList(board.intentions).text).toContain("- (02) I rest.\n- (01) I rest.");
  expect(a.number).toBe(51);
});
