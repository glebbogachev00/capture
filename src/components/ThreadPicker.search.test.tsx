// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FragView } from "./ThreadView";
import type { Thread } from "@/lib/model";

afterEach(cleanup);
const threads: Thread[] = [
  { id: "launch", name: "Capture launch", summary: "", frags: [] },
  { id: "writing", name: "Walking articles", summary: "", frags: [] },
];
function setup() {
  const props = {
    f: { id: "f", text: "A thought", at: 1 }, others: threads, busy: false,
    onSave: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onMoveToNew: vi.fn(),
    onCopy: vi.fn(), onExtract: vi.fn(), onResolve: vi.fn(), onAddImages: vi.fn(),
  };
  render(<FragView {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "More options" }));
  fireEvent.click(screen.getByRole("button", { name: "Move" }));
  return props;
}
it("filters destinations by trimmed, case-insensitive name without moving anything until selection", () => {
  const props = setup();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search threads" }), { target: { value: "  WALKING  " } });
  expect(screen.queryByRole("button", { name: /Capture launch/ })).toBeNull();
  expect(props.onMove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Walking articles/ }));
  expect(props.onMove).toHaveBeenCalledWith("writing");
  expect(screen.queryByRole("searchbox")).toBeNull();
});
it("keeps new-thread and cancel controls available when no names match, and resets when reopened", () => {
  setup();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
  expect(screen.getByText("No matching threads.")).toBeTruthy();
  expect(screen.getByRole("button", { name: /A new thread/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Move" }));
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  expect(screen.getByRole("button", { name: /Capture launch/ })).toBeTruthy();
});
