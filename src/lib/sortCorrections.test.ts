import { describe, expect, it } from "vitest";
import type { CorrectionEntry } from "./ledger";
import {
  canonicalForgottenCorrectionKeys,
  correctionExamples,
  correctionPreferences,
  setCorrectionEnabled,
} from "./sortCorrections";

const correction = (
  over: Partial<CorrectionEntry> & Pick<CorrectionEntry, "id" | "at">,
): CorrectionEntry => ({
  proposalKind: "undone",
  accepted: true,
  context: "A capture with enough meaning to learn from.",
  ...over,
});

describe("semantic correction examples", () => {
  it("returns recent explicit choices as examples rather than lexical rules", () => {
    const examples = correctionExamples([
      correction({
        id: "older",
        at: 1,
        context: "I want to develop a book from several essays.",
        chosenKind: "thread",
        chosenThreadId: "book",
        chosenThreadName: "Book project",
        rule: 'Captures about "book essays" belong in "Book project"',
      }),
      correction({
        id: "newer",
        at: 2,
        context: "Call the dentist tomorrow.",
        chosenKind: "action",
      }),
    ], [{ id: "book", name: "Book project" }], []);

    expect(examples).toEqual([
      { capture: "Call the dentist tomorrow.", chosenKind: "action" },
      {
        capture: "I want to develop a book from several essays.",
        chosenKind: "thread",
        chosenThreadId: "book",
        chosenThreadName: "Book project",
      },
    ]);
  });

  it("ignores proposal noise, rejected outcomes, and legacy rows without an explicit chosen kind", () => {
    const examples = correctionExamples([
      correction({ id: "rejected", at: 3, accepted: false, chosenKind: "thread" }),
      correction({ id: "proposal", at: 2, proposalKind: "rename_thread" }),
      correction({ id: "blank", at: 1, context: " ", chosenKind: "action" }),
    ], [], []);

    expect(examples).toEqual([]);
  });

  it("honors a disabled learned preference without requiring every example to have a rule", () => {
    const rule = 'Captures about "draft launch" belong in "Launch"';
    const examples = correctionExamples([
      correction({ id: "disabled", at: 2, chosenKind: "thread", rule }),
      correction({ id: "direct", at: 1, chosenKind: "intention", rule: undefined }),
    ], [], [rule.toLowerCase()]);

    expect(examples).toEqual([
      {
        capture: "A capture with enough meaning to learn from.",
        chosenKind: "intention",
      },
    ]);
  });

  it("interprets and migrates legacy lowercase rule keys to stable correction ids", () => {
    const rule = 'Captures about "draft launch" belong in "Launch"';
    const rows = [correction({
      id: "stable-id",
      at: 2,
      chosenKind: "thread",
      chosenThreadName: "Launch",
      rule,
    })];
    const legacy = [rule.toLowerCase()];

    expect(canonicalForgottenCorrectionKeys(rows, legacy)).toEqual(["correction:stable-id"]);
    expect(correctionPreferences(rows, legacy)[0]).toMatchObject({
      key: "correction:stable-id",
      enabled: false,
    });
    expect(correctionExamples(rows, [], legacy)).toEqual([]);
  });

  it("removes the legacy exclusion when the stable Settings switch is re-enabled", () => {
    const rule = "Keep launch notes in Launch";
    const rows = [correction({
      id: "stable-id",
      at: 2,
      chosenKind: "thread",
      chosenThreadName: "Launch",
      rule,
    })];
    const enabled = setCorrectionEnabled(rows, [rule.toLowerCase()], "correction:stable-id", true);

    expect(enabled).toEqual([]);
    expect(correctionPreferences(rows, enabled)[0].enabled).toBe(true);
    expect(correctionExamples(rows, [], enabled)).toHaveLength(1);
  });

  it("derives Settings text and model context from the same bounded correction record", () => {
    const context = `A private correction ${"semantic ".repeat(80)}tail`;
    const rows = [correction({
      id: "bounded",
      at: 2,
      context,
      chosenKind: "thread",
      chosenThreadName: `Writing ${"destination ".repeat(30)}`,
    })];
    const preference = correctionPreferences(rows)[0];
    const example = correctionExamples(rows, [], [])[0];

    expect(example.capture.length).toBeLessThanOrEqual(240);
    expect(preference.text).toContain(`“${example.capture}”`);
    expect(preference.text).not.toContain("tail");
    expect(example.chosenThreadName?.length).toBeLessThanOrEqual(80);
  });

  it("uses stable correction keys so every advisory example is visible and clearable", () => {
    const rows = [correction({
      id: "stable-id",
      at: 2,
      context: "A bounded subject that was explicitly corrected.",
      chosenKind: "thread",
      chosenThreadName: "Writing",
    })];
    expect(correctionPreferences(rows)).toEqual([
      expect.objectContaining({
        key: "correction:stable-id",
        text: expect.stringContaining("Writing"),
        enabled: true,
      }),
    ]);
    expect(correctionExamples(rows, [], ["correction:stable-id"])).toEqual([]);
  });

  it("keeps a chosen destination name when its old thread no longer exists but never sends a stale id", () => {
    const examples = correctionExamples([
      correction({
        id: "moved",
        at: 1,
        chosenKind: "thread",
        chosenThreadId: "gone",
        chosenThreadName: "Long-form writing",
      }),
    ], [{ id: "current", name: "Current" }], []);

    expect(examples).toEqual([{
      capture: "A capture with enough meaning to learn from.",
      chosenKind: "thread",
      chosenThreadName: "Long-form writing",
    }]);
  });

  it("is bounded to the five newest examples and caps source text", () => {
    const rows = Array.from({ length: 7 }, (_, index) => correction({
      id: String(index),
      at: index,
      context: `${index}:${"x".repeat(700)}`,
      chosenKind: "thread",
    }));

    const examples = correctionExamples(rows, [], [], 5);
    expect(examples).toHaveLength(5);
    expect(examples.map((example) => example.capture[0])).toEqual(["6", "5", "4", "3", "2"]);
    expect(examples.every((example) => example.capture.length <= 500)).toBe(true);
  });

  it("never backfills an invisible older correction when a visible item is disabled", () => {
    const rows = Array.from({ length: 6 }, (_, index) => correction({
      id: String(index),
      at: index,
      context: `Visible choice ${index}`,
      chosenKind: "action",
    }));
    const visible = correctionPreferences(rows, ["correction:5"], 5);
    const examples = correctionExamples(rows, [], ["correction:5"], 5);

    expect(visible.map((item) => item.key)).toEqual([
      "correction:5", "correction:4", "correction:3", "correction:2", "correction:1",
    ]);
    expect(visible[0].enabled).toBe(false);
    expect(examples.map((example) => example.capture)).toEqual([
      "Visible choice 4", "Visible choice 3", "Visible choice 2", "Visible choice 1",
    ]);
    expect(examples.some((example) => example.capture === "Visible choice 0")).toBe(false);
  });
});
