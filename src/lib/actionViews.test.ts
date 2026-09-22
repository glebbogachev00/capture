import { describe, expect, it } from "vitest";
import type { Action } from "./model";
import { actionViews } from "./actionViews";

const action = (id: string, over: Partial<Action> = {}): Action => ({
  id,
  text: id,
  done: false,
  at: 1,
  shelf: "keep",
  expires: null,
  ...over,
});

describe("action views", () => {
  it("keeps failed sorts in Unsorted and out of the normal Actions list", () => {
    const views = actionViews([
      action("normal"),
      action("unsorted", { unsorted: true }),
      action("faded", { faded: true }),
      action("done", { done: true, unsorted: true }),
    ]);

    expect(views.live.map(({ id }) => id)).toEqual(["normal"]);
    expect(views.unsorted.map(({ id }) => id)).toEqual(["unsorted"]);
    expect(views.faded.map(({ id }) => id)).toEqual(["faded"]);
  });
});
