import { describe, expect, it } from "vitest";
import type { Action } from "./model";
import { mapAiGroups } from "./groupAi";

/*
 * The grouping lens can only ever reorder rows that are already on screen.
 * Everything the model says is checked against the real list first, because
 * a lens that invents a row, or shows one twice, is worse than a flat list.
 */

const act = (id: string, text: string): Action => ({
  id,
  text,
  done: false,
  at: 100,
  shelf: "keep",
  expires: null,
});

const ACTIONS = [
  act("a1", "Fix heat map bug"),
  act("a2", "Add shortened commands for capture: /a, /i, /t"),
  act("a3", "Identify and prototype new gamification ideas for capture"),
  act("a4", "Buy running clothes"),
  act("a5", "Give the caul lilies to my girlfriend"),
];

describe("mapAiGroups", () => {
  it("groups by subject where words never could", () => {
    /* The real list, 2026-08-19. These three share no content words at all,
       which is exactly why the word lens said nothing grouped. */
    const out = mapAiGroups(ACTIONS, [
      { label: "Capture app", ids: ["a1", "a2", "a3"] },
    ]);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].label).toBe("Capture app");
    expect(out.groups[0].actions.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
    expect(out.rest.map((a) => a.id)).toEqual(["a4", "a5"]);
  });

  it("drops ids that are not on the board", () => {
    const out = mapAiGroups(ACTIONS, [
      { label: "Capture app", ids: ["a1", "ghost", "a2"] },
    ]);
    expect(out.groups[0].actions.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(out.rest.map((a) => a.id)).toEqual(["a3", "a4", "a5"]);
  });

  it("never shows one action in two groups", () => {
    const out = mapAiGroups(ACTIONS, [
      { label: "Capture app", ids: ["a1", "a2"] },
      { label: "Also capture", ids: ["a2", "a3"] },
    ]);
    expect(out.groups[0].actions.map((a) => a.id)).toEqual(["a1", "a2"]);
    /* a2 is spoken for, which leaves the second group holding one row —
       and a group of one is just a row with a heading over it. */
    expect(out.groups).toHaveLength(1);
    expect(out.rest.map((a) => a.id)).toEqual(["a3", "a4", "a5"]);
  });

  it("returns a group's rows to the flat list when the group collapses", () => {
    /* a3 must not vanish because a group it was named in fell apart. */
    const out = mapAiGroups(ACTIONS, [{ label: "Lonely", ids: ["a3"] }]);
    expect(out.groups).toHaveLength(0);
    expect(out.rest.map((a) => a.id)).toEqual(["a1", "a2", "a3", "a4", "a5"]);
  });

  it("keeps board order inside a group and across the rest", () => {
    const out = mapAiGroups(ACTIONS, [
      { label: "Capture app", ids: ["a3", "a1", "a2"] },
    ]);
    expect(out.groups[0].actions.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("ignores a group with no name", () => {
    const out = mapAiGroups(ACTIONS, [{ label: "   ", ids: ["a1", "a2"] }]);
    expect(out.groups).toHaveLength(0);
    expect(out.rest).toHaveLength(5);
  });

  it("trims a label that would not fit on a line", () => {
    const out = mapAiGroups(ACTIONS, [
      {
        label: "Everything to do with the capture application and its bugs",
        ids: ["a1", "a2"],
      },
    ]);
    expect(out.groups[0].label.length).toBeLessThanOrEqual(29);
    expect(out.groups[0].label.endsWith("…")).toBe(true);
  });

  it("leaves the list flat when the model finds nothing", () => {
    const out = mapAiGroups(ACTIONS, []);
    expect(out.groups).toHaveLength(0);
    expect(out.rest.map((a) => a.id)).toEqual(["a1", "a2", "a3", "a4", "a5"]);
  });

  it("never loses an action, whatever the model says", () => {
    const out = mapAiGroups(ACTIONS, [
      { label: "One", ids: ["a1", "a2"] },
      { label: "Two", ids: ["a3", "a4", "nope"] },
      { label: "", ids: ["a5"] },
    ]);
    const seen = [...out.groups.flatMap((g) => g.actions), ...out.rest];
    expect(seen.map((a) => a.id).sort()).toEqual(["a1", "a2", "a3", "a4", "a5"]);
  });
});
