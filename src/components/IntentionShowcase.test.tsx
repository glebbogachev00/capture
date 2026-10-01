/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Intention } from "@/lib/model";
import { IntentionShowcase } from "./IntentionShowcase";
const item = (id: string, number: number): Intention => ({ id, number, rawInput: `Intention ${id}`, expandedIntention: `Intention ${id}`, recommendedActions: ["Walk", "Read", "Rest"], counterIntentions: ["Rush"], at: 1, updatedAt: 1 });
const intentions = [item("a", 51), item("b", 1), item("c", 47)];
const profile = { name: "", intentionShowcaseEnabled: true, pinnedIntentionIds: ["c", "missing", "a", "c"], intentionShowcaseCollapsed: false };
const props = () => ({ intentions, profile, onProfileChange: vi.fn(), onOpen: vi.fn() });
afterEach(() => { cleanup(); window.localStorage.clear(); });
const expand = () => fireEvent.click(screen.getByRole("button", { name: /Intention showcase/ }));
/* Cards stacked 180px apart; a scroll counts once it has settled. */
const viewport = () => {
  const box = screen.getByRole("group", { name: "Pinned intentions" });
  [...box.children].forEach((card, index) => Object.defineProperty(card, "offsetTop", { value: index * 180, configurable: true }));
  box.scrollTo = vi.fn();
  return box;
};
const scrollTo = (box: HTMLElement, top: number) => {
  fireEvent.scroll(box, { target: { scrollTop: top } });
  act(() => { vi.advanceTimersByTime(200); });
};
it("starts closed the first time, then remembers open or closed on this device", () => {
  const p = props(); const first = render(<IntentionShowcase {...p} />);
  expect(screen.getByRole("button", { name: "Intention showcase 2" }).getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("article")).toBeNull();
  expand(); expect(screen.getByRole("article")).toBeTruthy();
  first.unmount();
  const reopened = render(<IntentionShowcase {...p} />);
  expect(screen.getByRole("button", { name: "Intention showcase 2" }).getAttribute("aria-expanded")).toBe("true");
  expand(); reopened.unmount();
  render(<IntentionShowcase {...p} />);
  expect(screen.getByRole("button", { name: "Intention showcase 2" }).getAttribute("aria-expanded")).toBe("false");
  expect(p.onProfileChange).not.toHaveBeenCalled();
});
it("reuses the original card, with action/counter/date metadata and no number or extra details button", () => {
  const p = props();const { container } = render(<IntentionShowcase {...p} />);expand();
  const card = screen.getByRole("article", { name: "Intention 1" });
  expect(within(card).getByText("Intention c")).toBeTruthy();
  expect(card.querySelector(".act-meta")?.textContent).toMatch(/3 actions · 1 counter ·/);
  expect(card.querySelector(".int-number")).toBeNull();
  expect(container.querySelector(".tcard .int-card-text")).not.toBeNull();
  expect(screen.queryByText(/View full intention|Open details/)).toBeNull();
  fireEvent.click(within(card).getByRole("button"));expect(p.onOpen).toHaveBeenCalledWith("c");
  expect(screen.getAllByRole("article", { hidden: true })).toHaveLength(2);
});
it("switches by scrolling or keys, with no arrows or count", () => {
  vi.useFakeTimers();
  try {
    render(<IntentionShowcase {...props()} />);expand();
    expect(screen.queryByRole("button", { name: /Next intention|Previous intention/ })).toBeNull();
    expect(screen.queryByText(/\d of \d/)).toBeNull();
    const box = viewport();
    scrollTo(box, 170);
    expect(screen.getByRole("article", { name: "Intention 3" })).toBeTruthy();
    scrollTo(box, 0);
    expect(screen.getByRole("article", { name: "Intention 1" })).toBeTruthy();
    fireEvent.keyDown(box, { key: "End" });
    expect(box.scrollTo).toHaveBeenCalledWith({ top: 180, behavior: "smooth" });
    expect(fireEvent.keyDown(box, { key: "Tab" })).toBe(true);
  } finally { vi.useRealTimers(); }
});
it("comes back to the intention that was showing, after closing or reopening the app", () => {
  vi.useFakeTimers();
  try {
    const p = props(); const first = render(<IntentionShowcase {...p} />);expand();
    scrollTo(viewport(), 180);
    expand(); expand();
    expect(screen.getByRole("article", { name: "Intention 3" })).toBeTruthy();
    first.unmount(); render(<IntentionShowcase {...p} />);
    expect(screen.getByRole("article", { name: "Intention 3" })).toBeTruthy();
  } finally { vi.useRealTimers(); }
});
it("shows no navigation for one pin and never auto-selects from an empty selection", () => {
  const p = props();const { rerender } = render(<IntentionShowcase {...p} profile={{ ...profile, pinnedIntentionIds: ["a"] }} />);expand();
  expect(screen.queryByRole("button", { name: "Next intention" })).toBeNull();
  rerender(<IntentionShowcase {...p} profile={{ ...profile, pinnedIntentionIds: [] }} />);
  expect(screen.queryByRole("article")).toBeNull();expect(p.onProfileChange).not.toHaveBeenCalled();
});
