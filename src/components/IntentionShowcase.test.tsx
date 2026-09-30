/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Intention } from "@/lib/model";
import { IntentionShowcase } from "./IntentionShowcase";
const item = (id: string, number: number): Intention => ({ id, number, rawInput: `Intention ${id}`, expandedIntention: `Intention ${id}`, recommendedActions: ["Walk", "Read", "Rest"], counterIntentions: ["Rush"], at: 1, updatedAt: 1 });
const intentions = [item("a", 51), item("b", 1), item("c", 47)];
const profile = { name: "", intentionShowcaseEnabled: true, pinnedIntentionIds: ["c", "missing", "a", "c"], intentionShowcaseCollapsed: false };
const props = () => ({ intentions, profile, onProfileChange: vi.fn(), onOpen: vi.fn() });
afterEach(cleanup);
const expand = () => fireEvent.click(screen.getByRole("button", { name: /Intention showcase/ }));
it("starts closed even with an old expanded preference and collapses on re-enable", () => {
  const p = props(); const { rerender } = render(<IntentionShowcase {...p} />);
  expect(screen.getByRole("button", { name: "Intention showcase 2" }).getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("article")).toBeNull();
  expand(); expect(screen.getByRole("article")).toBeTruthy();
  rerender(<IntentionShowcase {...p} profile={{ ...profile, intentionShowcaseEnabled: false }} />);
  expect(screen.queryByRole("region")).toBeNull();
  rerender(<IntentionShowcase {...p} />);
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
it("keeps scroll and keyboard navigation between only pinned items", () => {
  render(<IntentionShowcase {...props()} />);expand();
  const viewport = screen.getByRole("group", { name: "Pinned intentions" });
  Object.defineProperty(viewport, "clientHeight", { value: 180 });viewport.scrollTo = vi.fn();
  fireEvent.click(screen.getByRole("button", { name: "Next intention" }));
  expect(screen.getByRole("article", { name: "Intention 3" })).toBeTruthy();
  fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
  expect(screen.getByRole("article", { name: "Intention 1" })).toBeTruthy();
  fireEvent.keyDown(viewport, { key: "End" });
  expect(screen.getByRole("article", { name: "Intention 3" })).toBeTruthy();
  expect(fireEvent.keyDown(viewport, { key: "Tab" })).toBe(true);
});
it("shows no navigation for one pin and never auto-selects from an empty selection", () => {
  const p = props();const { rerender } = render(<IntentionShowcase {...p} profile={{ ...profile, pinnedIntentionIds: ["a"] }} />);expand();
  expect(screen.queryByRole("button", { name: "Next intention" })).toBeNull();
  rerender(<IntentionShowcase {...p} profile={{ ...profile, pinnedIntentionIds: [] }} />);
  expect(screen.queryByRole("article")).toBeNull();expect(p.onProfileChange).not.toHaveBeenCalled();
});
