import { describe, expect, it } from "vitest";
import { EMPTY, hydrate } from "./model";
import { parsePersistedBoard } from "./persistedBoard";
import { boardSignature, mergeBoards } from "./sync";
import { applyProfileUpdate, toggleIntentionPin } from "./intentionShowcasePrefs";

it("profile edits preserve preferences and sync metadata without giving the updater a timestamp", () => {
  const board = { ...EMPTY, profile: { name: "Ada", imageId: "photo", ...preferences, updatedAt: 12 } };
  const next = applyProfileUpdate(board, (current) => {
    expect(current).not.toHaveProperty("updatedAt");
    expect(current).toMatchObject(preferences);
    return { ...current, name: "Grace", imageId: undefined };
  });
  expect(next.profile).toEqual({ ...board.profile, name: "Grace", imageId: undefined });
  expect(next.ledger).toBe(board.ledger);
  expect(next.intentions).toBe(board.intentions);
  expect(board.profile.name).toBe("Ada");
  expect(applyProfileUpdate(board, { name: "Grace" }).profile).toEqual({ ...board.profile, name: "Grace" });
  expect(applyProfileUpdate(EMPTY, (current) => {
    expect(current).toEqual({ name: "" });
    return current;
  }).profile).toEqual({ name: "" });
});

it("pins and unpins exactly the selected id without mutating the draft", () => {
  const current = { name: "Ada", imageId: "photo", showSignature: true,
    intentionShowcaseEnabled: false, intentionShowcaseCollapsed: true };
  const pinned = toggleIntentionPin(current, " A ");
  expect(pinned).toEqual({ ...current, pinnedIntentionIds: [" A "] });
  expect(toggleIntentionPin(pinned, "A").pinnedIntentionIds).toEqual([" A ", "A"]);
  expect(toggleIntentionPin(pinned, " A ")).toEqual({ ...current, pinnedIntentionIds: [] });
  expect(current).not.toHaveProperty("pinnedIntentionIds");
});

it("deduplicates pins on both adding and removing", () => {
  const current = { name: "Ada", pinnedIntentionIds: ["A", "B", "A", "B"] };
  expect(toggleIntentionPin(current, "C").pinnedIntentionIds).toEqual(["A", "B", "C"]);
  expect(toggleIntentionPin(current, "A").pinnedIntentionIds).toEqual(["B"]);
  expect(current.pinnedIntentionIds).toEqual(["A", "B", "A", "B"]);
});

it.each([
  { intentionShowcaseEnabled: true },
  { pinnedIntentionIds: ["A"] },
  { intentionShowcaseCollapsed: true },
])("fingerprints preference changes even with equal timestamps: %j", (change) => {
  const before = { ...EMPTY, profile: { name: "Ada", updatedAt: 10 } };
  const after = { ...before, profile: { ...before.profile, ...change } };
  expect(boardSignature(after, [])).not.toBe(boardSignature(before, []));
});

it("merges the complete newer profile without unioning pins", () => {
  const older = { ...EMPTY, profile: { name: "Ada", ...preferences, updatedAt: 10 } };
  const newer = { ...EMPTY, profile: { name: "Grace", ...preferences,
    intentionShowcaseEnabled: false, pinnedIntentionIds: ["C"], updatedAt: 20 } };
  expect(mergeBoards(older, newer).profile).toEqual(newer.profile);
  expect(mergeBoards(newer, older).profile).toEqual(newer.profile);
  expect(mergeBoards(older, { ...newer, profile: { ...newer.profile, updatedAt: 10 } }).profile).toEqual(older.profile);
});

const preferences = {
  intentionShowcaseEnabled: true,
  pinnedIntentionIds: ["A", "B"],
  intentionShowcaseCollapsed: true,
};

describe("persisted Intention showcase preferences", () => {
  it("retains preferences through validation and hydration", () => {
    const raw = { ...EMPTY, profile: { name: "Ada", ...preferences, updatedAt: 12 } };
    const parsed = parsePersistedBoard(raw);
    expect(parsed).not.toBeNull();
    expect(hydrate(parsed!).profile).toMatchObject(raw.profile);
    expect(hydrate(hydrate(parsed!)).profile).toEqual(hydrate(parsed!).profile);
  });

  it("keeps legacy profile snapshots unchanged and defaults off with no pins", () => {
    const profile = hydrate(parsePersistedBoard({ ...EMPTY, profile: { name: "Ada" } })!).profile;
    expect(profile).toStrictEqual({ name: "Ada", imageId: undefined, showSignature: false, updatedAt: 0 });
    expect(profile?.intentionShowcaseEnabled ?? false).toBe(false);
    expect(profile?.pinnedIntentionIds ?? []).toEqual([]);
    expect(profile?.intentionShowcaseCollapsed ?? false).toBe(false);
    expect(hydrate(EMPTY).profile).toBeUndefined();
  });

  it.each([
    { intentionShowcaseEnabled: "true" },
    { pinnedIntentionIds: "A" },
    { pinnedIntentionIds: ["A", 7] },
    { intentionShowcaseCollapsed: 1 },
  ])("rejects malformed showcase preferences: %j", (invalid) => {
    expect(parsePersistedBoard({ ...EMPTY, profile: { name: "Ada", ...invalid } })).toBeNull();
  });
});
