import { describe, expect, it } from "vitest";
import type { Action } from "./model";
import { groupActions } from "./group";

function action(id: string, text: string): Action {
  return { id, text, done: false, at: 0, shelf: "keep", expires: null };
}

describe("groupActions", () => {
  it("groups nothing when nothing connects", () => {
    const { groups, rest } = groupActions([
      action("a", "return the library books"),
      action("b", "descale the espresso machine"),
      action("c", "renew the passport"),
    ]);
    expect(groups).toEqual([]);
    expect(rest.map((a) => a.id)).toEqual(["a", "b", "c"]);
  });

  it("groups on a shared phrase and names the group by it", () => {
    const { groups, rest } = groupActions([
      action("a", "file the insurance claim before June"),
      action("b", "find the insurance claim paperwork"),
      action("c", "water the plants"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("insurance claim");
    expect(groups[0].actions.map((a) => a.id)).toEqual(["a", "b"]);
    expect(rest.map((a) => a.id)).toEqual(["c"]);
  });

  it("groups on a distinctive shared word", () => {
    const { groups } = groupActions([
      action("a", "book the dentist appointment"),
      action("b", "cancel the old dentist reminder"),
      action("c", "water the plants"),
      action("d", "renew the passport"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("dentist");
    expect(groups[0].actions.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("a word carried by more than half the actions groups nothing", () => {
    const { groups, rest } = groupActions([
      action("a", "email Sam the invoice"),
      action("b", "email the landlord"),
      action("c", "email the school"),
      action("d", "email the accountant"),
    ]);
    /* "email" is in all four — noise, not a subject. */
    expect(groups).toEqual([]);
    expect(rest).toHaveLength(4);
  });

  it("connections are transitive", () => {
    const { groups } = groupActions([
      action("a", "fix the garden fence gate"),
      action("b", "paint the garden fence"),
      action("c", "buy paint for the shed"),
      action("d", "renew the passport"),
    ]);
    /* a–b share "garden fence", b–c share "paint": one group of three. */
    expect(groups).toHaveLength(1);
    expect(groups[0].actions.map((a) => a.id)).toEqual(["a", "b", "c"]);
    /* The phrase vote outweighs the word vote. */
    expect(groups[0].label).toBe("garden fence");
  });

  it("keeps board order inside groups and orders groups by newest member", () => {
    const { groups } = groupActions([
      action("a", "call about the boiler service"),
      action("b", "pay the school trip deposit"),
      action("c", "book the boiler service"),
      action("d", "sign the school trip form"),
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "boiler service",
      "school trip",
    ]);
    expect(groups[0].actions.map((x) => x.id)).toEqual(["a", "c"]);
    expect(groups[1].actions.map((x) => x.id)).toEqual(["b", "d"]);
  });

  it("names a group in the user's own words, not the matched tokens", () => {
    const { groups } = groupActions([
      action("a", "write the step-by-step setup guide"),
      action("b", "record a video of the step by step setup"),
      action("c", "water the plants"),
    ]);
    expect(groups).toHaveLength(1);
    /* The match is the content-word run "step step setup"; the label is how
       a member actually writes it. */
    expect(groups[0].label).toBe("step-by-step setup");
  });

  it("handles an empty list", () => {
    expect(groupActions([])).toEqual({ groups: [], rest: [] });
  });
});
