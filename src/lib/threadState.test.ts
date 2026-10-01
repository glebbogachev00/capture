import { describe, expect, it } from "vitest";
import { normalizeState, parseState, snapshotOf } from "./threadState";
import { splitNext } from "./nextStep";

const reply = `Capture is a thinking tool built in phases; launch work is done and Ask now answers from notes.

Decided:
- Build in phases: get it in, keep it alive, find it, decide (26 Sep)
- Don't push monetisation (replaced $5/month pricing push, 1 Oct)
Still open:
- How to add daily contracts without bloat
Keeps coming up:
- Resurfacing old ideas automatically (13 Sep – 27 Sep)
NEXT: none
BELONGS: Capture the product, not Retake.`;

describe("parseState", () => {
  it("reads the snapshot and each list from a structured summary", () => {
    const { summary, next, belongs } = splitNext(reply);
    expect(next).toBeNull();
    expect(belongs).toBe("Capture the product, not Retake.");
    expect(parseState(summary)).toEqual({
      snapshot: "Capture is a thinking tool built in phases; launch work is done and Ask now answers from notes.",
      decided: [
        "Build in phases: get it in, keep it alive, find it, decide (26 Sep)",
        "Don't push monetisation (replaced $5/month pricing push, 1 Oct)",
      ],
      open: ["How to add daily contracts without bloat"],
      recurring: ["Resurfacing old ideas automatically (13 Sep – 27 Sep)"],
    });
  });

  it("treats an old prose summary as all snapshot", () => {
    const old = "Pricing is settled on annual. The free tier question is still open.";
    expect(parseState(old)).toEqual({ snapshot: old, decided: [], open: [], recurring: [] });
    expect(parseState(undefined).snapshot).toBe("");
  });

  it("accepts the shapes models actually write: inline, bold, other bullets, 'none'", () => {
    const messy = `Snapshot here.\n\n**Decided:** annual at $96; no sync on free\n**Open questions:**\n* free tier limits\n• what to call it\nKeeps coming up: none`;
    expect(parseState(messy)).toEqual({
      snapshot: "Snapshot here.",
      decided: ["annual at $96", "no sync on free"],
      open: ["free tier limits", "what to call it"],
      recurring: [],
    });
  });

  it("leaves ordinary 'Word: …' prose in the snapshot", () => {
    expect(parseState("Note: the tap leaks. Plumber: Tomasz.").snapshot).toBe("Note: the tap leaks. Plumber: Tomasz.");
  });

  it("caps each list so a summary never becomes a second thread", () => {
    const many = `S.\nDecided:\n${Array.from({ length: 9 }, (_, i) => `- d${i}`).join("\n")}\nKeeps coming up:\n- a\n- b\n- c\n- d`;
    const s = parseState(many);
    expect(s.decided).toHaveLength(5);
    expect(s.recurring).toEqual(["a", "b", "c"]);
  });
});

describe("normalizeState", () => {
  it("writes one shape whatever the model wrote, and drops empty lists", () => {
    expect(normalizeState("Snap.\n**Decided:** a; b\nStill open: none")).toBe("Snap.\n\nDecided:\n- a\n- b");
  });

  it("is stable: normalising twice changes nothing", () => {
    const once = normalizeState(splitNext(reply).summary);
    expect(normalizeState(once)).toBe(once);
  });

  it("leaves a plain prose summary exactly as it was", () => {
    expect(normalizeState("Just prose. Two sentences.")).toBe("Just prose. Two sentences.");
  });
});

it("snapshotOf gives a card just the overview", () => {
  expect(snapshotOf(splitNext(reply).summary)).toMatch(/^Capture is a thinking tool/);
  expect(snapshotOf(splitNext(reply).summary)).not.toContain("Decided");
});
