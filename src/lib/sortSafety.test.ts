import { expect, it, vi } from "vitest";
import { applySorted, type SortResult } from "./boardOps";
import { EMPTY } from "./model";
import { reconcileSorted } from "./sort";

const base: SortResult = {
  kind: "both", clean: "Pricing thinking. Call mom this weekend.", title: "Pricing",
  primaryText: "Pricing thinking.", threadName: "Pricing", actions: ["Call mom this weekend"],
};

it.each([
  "Call mom this weekend", "Also, call mom this weekend.",
  "- Call mom this weekend\n- Fix the Stripe webhook retry bug",
  "Call mom this weekend. Fix the Stripe webhook retry bug.",
])("keeps action-only also material as tasks, not secondary thinking: %s", text => {
  const input = { ...base, actions: [...base.actions!, "Fix the Stripe webhook retry bug"], also: [{ text, threadName: "Errands" }] };
  const out = reconcileSorted(input);
  expect(out.also).toEqual([]);
  expect(applySorted(input, [], 1000, EMPTY).next.threads).toHaveLength(1);
  expect(reconcileSorted(out)).toEqual(out);
  expect(input.also[0].text).toBe(text);
});

it.each([
  "Call mom this weekend. I am unsure how to discuss the move.",
  "Call mom this weekend?",
  "I am weighing a quieter home.\n\nThe traffic keeps me awake.",
])("preserves secondary thinking with no destination: %s", text => {
  const input = { ...base, also: [{ text, threadId: null, threadName: null }] };
  const out = reconcileSorted(input);
  expect(out.also).toEqual(input.also);
  const { next } = applySorted(out, [], 1000, EMPTY);
  expect(next.threads).toHaveLength(2);
  expect(next.threads[0].frags[0].text).toBe(text);
});

it("preserves multiple independent new thinking subjects and clean paragraphs", () => {
  const input = { ...base, clean: "Pricing thinking.\n\nCall mom this weekend.", also: [
    { text: "The garden is too shaded.", threadName: null },
    { text: "I am debating the onboarding flow.", threadName: "Onboarding" },
    { text: "Call mom this weekend", threadName: null },
  ] };
  const out = reconcileSorted(input);
  const { next } = applySorted(out, [], 1000, EMPTY);
  expect(next.threads).toHaveLength(3);
  expect(next.threads.flatMap(t => t.frags.map(f => f.text))).toEqual([
    "I am debating the onboarding flow.", "The garden is too shaded.", "Pricing thinking.",
  ]);
  expect(out.clean).toBe(input.clean);
});

it.each(["action", "both"] as const)("keeps single-action dates but refuses ambiguous scalar dates on multiple %s tasks", kind => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-13T12:00:00Z"));
  try {
    const single = { ...base, kind, due: "2026-09-19" };
    const one = applySorted(reconcileSorted(single), [], Date.now(), EMPTY).next.actions[0];
    expect(one.due).toBeTruthy();
    const multiple = { ...single, actions: ["Call mom this weekend", "Send the draft this weekend"] };
    // Even a plausibly shared deadline lacks an explicit per-action selector.
    expect(reconcileSorted(multiple).due).toBeNull();
    expect(applySorted(multiple, [], Date.now(), EMPTY).next.actions.map(a => a.due)).toEqual([null, null]);
  } finally { vi.useRealTimers(); }
});
