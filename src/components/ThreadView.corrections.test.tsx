// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThreadView } from "./ThreadView";
import type { Thread } from "@/lib/model";

afterEach(cleanup);
const original: Thread = { id: "t", name: "Old title", summary: "", frags: [{ id: "f", text: "Old text", at: 1 }] };
function props(thread: Thread) {
  return { thread, others: [], fromActions: { open: [], done: [] }, busy: false,
    onBack: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onRefreshSummary: vi.fn(),
    onEditFrag: vi.fn(), onDeleteFrag: vi.fn(), onMerge: vi.fn(), onSetCover: vi.fn(),
    onMoveFrag: vi.fn(), onMoveFragToNew: vi.fn(), onCopyThread: vi.fn(), onCopyFrag: vi.fn(),
    onExtractAction: vi.fn(), onResolveFrag: vi.fn(), onAddFragImages: vi.fn(), onTakeNext: vi.fn(), onDismissNext: vi.fn() };
}
it.each(["title", "text"])("opens the %s editor with current props rather than its mount-time draft", async (kind) => {
  const p = props(original);
  const view = render(<ThreadView {...p} />);
  view.rerender(<ThreadView {...p} thread={{ ...original, name: "Corrected title", frags: [{ ...original.frags[0], text: "Corrected text" }] }} />);
  fireEvent.click(screen.getAllByRole("button", { name: "More options" })[kind === "title" ? 0 : 1]);
  fireEvent.click(screen.getByRole("button", { name: kind === "title" ? "Rename" : "Edit" }));
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(kind === "title" ? "Corrected title" : "Corrected text");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  if (kind === "title") expect(p.onRename).toHaveBeenCalledWith("Corrected title");
  else expect(p.onEditFrag).toHaveBeenCalledWith("f", "Corrected text");
});
