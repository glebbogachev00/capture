// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThreadChoices } from "./ThreadChoices";
import type { Thread } from "@/lib/model";

afterEach(cleanup);
const threads: Thread[] = [
  { id: "a", name: "Capture launch", summary: "", frags: [] },
  { id: "b", name: "Walking articles", summary: "", frags: [{ id: "f", text: "Draft", at: 1 }] },
];
it("keeps typing and focus through a props refresh and selects the actual ID", () => {
  const onSelect = vi.fn();
  const view = render(<ThreadChoices threads={threads} onSelect={onSelect} countLabel="layer" />);
  const search = screen.getByRole("searchbox") as HTMLInputElement;
  search.focus();
  fireEvent.change(search, { target: { value: "walking" } });
  view.rerender(<ThreadChoices threads={threads.map((thread) => ({ ...thread }))} onSelect={onSelect} countLabel="layer" />);
  expect(document.activeElement).toBe(search);
  expect(search.value).toBe("walking");
  expect(screen.getByText("1 layer")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Walking articles/ }));
  expect(onSelect).toHaveBeenCalledWith("b");
});
it("does not submit a parent form or choose a destination on Enter", () => {
  const onSelect = vi.fn();
  const onSubmit = vi.fn();
  render(<form onSubmit={onSubmit}><ThreadChoices threads={threads} onSelect={onSelect} /></form>);
  const search = screen.getByRole("searchbox");
  fireEvent.change(search, { target: { value: "walking" } });
  expect(fireEvent.keyDown(search, { key: "Enter" })).toBe(false);
  expect(onSubmit).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
});
it("clears filtering on Escape and provides an honest empty state", () => {
  const view = render(<ThreadChoices threads={threads} onSelect={vi.fn()} />);
  const search = screen.getByRole("searchbox");
  fireEvent.change(search, { target: { value: "absent" } });
  expect(screen.getByRole("status").textContent).toBe("No matching threads.");
  fireEvent.keyDown(search, { key: "Escape" });
  expect((search as HTMLInputElement).value).toBe("");
  expect(screen.getAllByRole("button")).toHaveLength(2);
  view.rerender(<ThreadChoices threads={[]} onSelect={vi.fn()} />);
  expect(screen.getByRole("status").textContent).toBe("No other threads.");
});
