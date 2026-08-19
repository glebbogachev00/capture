import { describe, expect, it } from "vitest";
import { deriveRules, RULES_CAP } from "./rules";
import type { CorrectionEntry } from "./ledger";

const correction = (
  over: Partial<CorrectionEntry> & Pick<CorrectionEntry, "rule">
): CorrectionEntry => ({
  id: over.id || String(Math.random()),
  at: over.at ?? 1000,
  proposalKind: over.proposalKind || "related_suggestion",
  accepted: over.accepted ?? true,
  context: over.context || "some context",
  rule: over.rule,
  correctionText: over.correctionText,
});

describe("deriveRules", () => {
  it("returns nothing from an empty ledger", () => {
    expect(deriveRules([], [], 2000)).toEqual([]);
  });

  it("ignores corrections without a rule — free-text fixes are not preferences", () => {
    const c = correction({
      rule: "",
      proposalKind: "clean_fragment",
    });
    expect(deriveRules([c], [], 2000)).toEqual([]);
  });

  it("needs at least two agreeing signals before a rule exists", () => {
    const one = correction({ rule: "Move threads into X", at: 100 });
    expect(deriveRules([one], [], 2000)).toEqual([]);
  });

  it("builds a positive rule from two accepts, with full confidence", () => {
    const a = correction({ rule: "Merge threads into X", at: 100 });
    const b = correction({ rule: "Merge threads into X", at: 200 });
    const rules = deriveRules([a, b], [], 2000);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      key: "merge threads into x",
      text: "Merge threads into X",
      accepts: 2,
      dismisses: 0,
      confidence: 1,
    });
  });

  it("counts dismisses against a rule and excludes mixed evidence", () => {
    const mk = (accepted: boolean, at: number) =>
      correction({ rule: "Keep threads out of Y", accepted, at });
    // Two for, two against → 50% → the user is inconsistent, drop it.
    const mixed = deriveRules(
      [mk(true, 1), mk(true, 2), mk(false, 3), mk(false, 4)],
      [],
      2000
    );
    expect(mixed).toEqual([]);
  });

  it("surfaces a dismiss-heavy rule as a negative preference", () => {
    const mk = (accepted: boolean, at: number) =>
      correction({ rule: "Keep threads out of Y", accepted, at });
    const rules = deriveRules(
      [mk(false, 1), mk(false, 2), mk(false, 3)],
      [],
      2000
    );
    expect(rules).toHaveLength(1);
    expect(rules[0].dismisses).toBe(3);
    expect(rules[0].confidence).toBeCloseTo(0);
  });

  it("caps at RULES_CAP rules", () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      correction({ rule: `Rule number ${i}`, at: 1000 + i })
    ).map((c, i, all) =>
      all.filter((x) => x.rule === c.rule).length >= 2 ? c : c
    );
    // Two signals per rule: 15 rules → capped to 5.
    const doubled = entries.flatMap((c) => [c, { ...c, id: c.id + "b" }]);
    const rules = deriveRules(doubled, [], 3000);
    expect(rules.length).toBe(RULES_CAP);
  });

  it("ranks fresher, more one-sided rules first", () => {
    const oldStrong = correction({
      rule: "Old strong rule",
      at: 100,
    });
    const oldStrong2 = correction({
      rule: "Old strong rule",
      at: 101,
    });
    const freshWeak = correction({ rule: "Fresh weak rule", at: 990 });
    const freshWeak2 = correction({
      rule: "Fresh weak rule",
      at: 991,
    });
    const freshWeak3 = correction({
      rule: "Fresh weak rule",
      at: 992,
    });
    // Both at confidence 1; the fresh one outranks by recency.
    const rules = deriveRules(
      [oldStrong, oldStrong2, freshWeak, freshWeak2, freshWeak3],
      [],
      1000
    );
    expect(rules[0].text).toBe("Fresh weak rule");
    expect(rules[1].text).toBe("Old strong rule");
  });

  it("cleared rules stay cleared — forgetting is permanent for that wording", () => {
    const a = correction({ rule: "Merge threads into X", at: 100 });
    const b = correction({ rule: "Merge threads into X", at: 200 });
    const key = "merge threads into x";
    expect(deriveRules([a, b], [key], 2000)).toEqual([]);
    // Fresh signals with the same wording don't re-teach a cleared rule;
    // only a differently-worded rule (a new key) can be learned again.
    const c = correction({ rule: "Merge threads into X", at: 300 });
    const d = correction({ rule: "Merge threads into X", at: 400 });
    expect(deriveRules([a, b, c, d], [key], 2000)).toEqual([]);
    const fresh = correction({ rule: "Move threads into X", at: 500 });
    const fresh2 = correction({ rule: "Move threads into X", at: 600 });
    const rules = deriveRules([a, b, c, d, fresh, fresh2], [key], 2000);
    expect(rules).toHaveLength(1);
    expect(rules[0].text).toBe("Move threads into X");
  });

  it("keys are exact wordings — a different target is a different rule", () => {
    const a = correction({ rule: "Merge threads into X", at: 100 });
    const b = correction({ rule: "Merge threads into X", at: 200 });
    const c = correction({ rule: "Merge threads into Y", at: 300 });
    const d = correction({ rule: "Merge threads into Y", at: 400 });
    const rules = deriveRules([a, b, c, d], [], 2000);
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.text).sort()).toEqual([
      "Merge threads into X",
      "Merge threads into Y",
    ]);
  });
});

describe("deriveRules — an answer counts on its own", () => {
  const answered = (rule: string, at = 1000) => ({
    id: "c" + at,
    at,
    proposalKind: "undone" as const,
    accepted: true,
    context: "context",
    rule,
  });

  it("learns from one undo that was answered", () => {
    /* The capture was thrown away, the app asked what it should have been,
       and the person tapped a kind. Making them repeat that before it
       counts is just ignoring them. */
    const out = deriveRules(
      [answered('Captures about "cold brew" are an action, not a thread')],
      [],
      2000
    );
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe(
      'Captures about "cold brew" are an action, not a thread'
    );
  });

  it("still needs two signals for a rule nobody was asked about", () => {
    const inferred = {
      id: "c1",
      at: 1000,
      proposalKind: "rename_thread" as const,
      accepted: true,
      context: "context",
      rule: "Threads get renamed to their subject",
    };
    expect(deriveRules([inferred], [], 2000)).toHaveLength(0);
    expect(
      deriveRules([inferred, { ...inferred, id: "c2" }], [], 2000)
    ).toHaveLength(1);
  });

  it("still respects a rule the person chose to forget", () => {
    const rule = 'Captures about "cold brew" are an action, not a thread';
    expect(deriveRules([answered(rule)], [rule.toLowerCase()], 2000)).toEqual([]);
  });
});
