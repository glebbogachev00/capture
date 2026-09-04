import { describe, expect, it } from "vitest";
import {
  createCaptureGate,
  isClosedInPlayground,
  PLAYGROUND_CLOSED,
  TRIAL_LIMIT,
  trialUsed,
  trialRemaining,
  isTrialExhausted,
  trialState,
} from "./playground";
import type { CaptureEntry } from "./ledger";

const NOW = new Date(2026, 8, 4, 12).getTime();

const entry = (id: string, opts: Partial<CaptureEntry> = {}): CaptureEntry => ({
  id,
  at: NOW,
  raw: "said",
  clean: "clean",
  kind: "action",
  source: "typed",
  targetId: "t-" + id,
  ...opts,
});

const used = (ledger: CaptureEntry[]) => trialUsed(ledger, NOW);
const remaining = (ledger: CaptureEntry[]) => trialRemaining(ledger, NOW);
const exhausted = (ledger: CaptureEntry[]) => isTrialExhausted(ledger, NOW);
const state = (ledger: CaptureEntry[]) => trialState(ledger, NOW);

describe("playground — what the server refuses", () => {
  it("closes every route that reaches past the browser", () => {
    for (const p of PLAYGROUND_CLOSED) expect(isClosedInPlayground(p)).toBe(true);
    /* Sub-paths too: /api/img/<id> is how a picture is fetched. */
    expect(isClosedInPlayground("/api/img/abc123")).toBe(true);
  });

  it("leaves the model routes open — they are the point", () => {
    for (const p of ["/api/sort", "/api/distill", "/api/organize", "/api/summarize", "/api/intention", "/api/group"])
      expect(isClosedInPlayground(p)).toBe(false);
  });

  it("does not match by prefix accident", () => {
    /* "/api/synchronize" is not "/api/sync". */
    expect(isClosedInPlayground("/api/synchronize")).toBe(false);
  });
});

describe("daily trial limit", () => {
  it("TRIAL_LIMIT is 5", () => {
    expect(TRIAL_LIMIT).toBe(5);
  });

  it("starts with five captures available today", () => {
    expect(used([])).toBe(0);
    expect(remaining([])).toBe(TRIAL_LIMIT);
    expect(exhausted([])).toBe(false);
    expect(state([])).toEqual({
      exhausted: false,
      remaining: 5,
      hint: "five captures available today — say it messy",
    });
  });

  it("counts each ordinary entry from today as one utterance", () => {
    const ledger = [entry("a"), entry("b"), entry("c")];
    expect(used(ledger)).toBe(3);
    expect(remaining(ledger)).toBe(2);
    expect(exhausted(ledger)).toBe(false);
  });

  it("counts a split capture from today as one utterance", () => {
    const ledger = [
      entry("e1", { captureId: "cap1" }),
      entry("e2", { captureId: "cap1" }),
    ];
    expect(used(ledger)).toBe(1);
  });

  it("does not spend another slot when a corrected capture reuses its identity", () => {
    const ledger = [
      entry("original", { captureId: "cap1", undone: true }),
      entry("corrected", { captureId: "cap1" }),
    ];
    expect(used(ledger)).toBe(1);
  });

  it("does not move an older capture into today's allowance when corrected", () => {
    const yesterday = new Date(2026, 8, 3, 12).getTime();
    const ledger = [
      entry("original", { at: yesterday, captureId: "cap1", undone: true }),
      entry("corrected", { captureId: "cap1" }),
    ];
    expect(used(ledger)).toBe(0);
  });

  it("exhausts today's allowance at five distinct utterances", () => {
    const ledger = Array.from({ length: 5 }, (_, i) => entry(String(i)));
    expect(exhausted(ledger)).toBe(true);
    expect(remaining(ledger)).toBe(0);
    expect(state(ledger)).toEqual({
      exhausted: true,
      remaining: 0,
      hint: "today's five captures are used",
    });
  });

  it("does not make the remaining count negative", () => {
    const ledger = Array.from({ length: 6 }, (_, i) => entry(String(i)));
    expect(remaining(ledger)).toBe(0);
  });

  it("does not replenish today's allowance after Undo", () => {
    const ledger = [
      entry("a", { undone: true }),
      entry("b"),
      entry("c"),
    ];
    expect(used(ledger)).toBe(3);
  });

  it("does not count imports or backup restores as captures", () => {
    const ledger = [
      entry("captured"),
      entry("restored", { source: "import" }),
      entry("restored-history", { restored: true }),
    ];
    expect(used(ledger)).toBe(1);
  });

  it("counts one saved Distill conversation as one capture", () => {
    expect(used([entry("distilled", { source: "distill" })])).toBe(1);
  });

  it("counts an undone split capture once", () => {
    const ledger = [
      entry("e1", { captureId: "cap1", undone: true }),
      entry("e2", { captureId: "cap1", undone: true }),
      ...Array.from({ length: 4 }, (_, i) => entry("x" + i)),
    ];
    expect(used(ledger)).toBe(5);
    expect(exhausted(ledger)).toBe(true);
  });

  it("starts a fresh allowance on the next local calendar day", () => {
    const today = new Date(2026, 8, 4, 12).getTime();
    const yesterday = new Date(2026, 8, 3, 12).getTime();
    const ledger = [
      ...Array.from({ length: 5 }, (_, i) =>
        entry(`old-${i}`, { at: yesterday })
      ),
      entry("today", { at: today }),
    ];

    expect(trialUsed(ledger, today)).toBe(1);
    expect(trialRemaining(ledger, today)).toBe(4);
    expect(isTrialExhausted(ledger, today)).toBe(false);
  });
});

describe("capture submission gate", () => {
  it("allows only one submission until the active one leaves", () => {
    const gate = createCaptureGate();
    expect(gate.enter()).toBe(true);
    expect(gate.enter()).toBe(false);
    gate.leave();
    expect(gate.enter()).toBe(true);
  });
});
