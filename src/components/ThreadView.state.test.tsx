// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ThreadView } from "./ThreadView";
import type { Thread } from "@/lib/model";

afterEach(cleanup);
const props = (thread: Thread) => ({ thread, others: [], fromActions: { open: [], done: [] }, busy: false,
  onBack: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onRefreshSummary: vi.fn(),
  onEditFrag: vi.fn(), onDeleteFrag: vi.fn(), onMerge: vi.fn(), onSetCover: vi.fn(),
  onMoveFrag: vi.fn(), onMoveFragToNew: vi.fn(), onCopyThread: vi.fn(), onCopyFrag: vi.fn(),
  onExtractAction: vi.fn(), onResolveFrag: vi.fn(), onAddFragImages: vi.fn(), onTakeNext: vi.fn(), onDismissNext: vi.fn() });
const thread = (summary: string): Thread => ({ id: "t", name: "Pricing", summary, frags: [{ id: "f", text: "annual", at: 1 }] });

it("shows what is decided, still open and keeps coming up under Where this stands", () => {
  render(<ThreadView {...props(thread("Pricing is mostly settled.\n\nDecided:\n- Annual at $96\nKeeps coming up:\n- A student discount (13 Sep – 27 Sep)"))} />);
  const block = screen.getByText("Where this stands").parentElement!;
  expect(within(block).getByText("Pricing is mostly settled.")).toBeTruthy();
  expect(within(block).getByText("Decided")).toBeTruthy();
  expect(within(block).getByText("Annual at $96")).toBeTruthy();
  expect(within(block).getByText("A student discount (13 Sep – 27 Sep)")).toBeTruthy();
  expect(within(block).queryByText("Still open")).toBeNull();
});

it("shows an older prose summary exactly as before", () => {
  render(<ThreadView {...props(thread("Pricing is settled on annual."))} />);
  const block = screen.getByText("Where this stands").parentElement!;
  expect(within(block).getByText("Pricing is settled on annual.")).toBeTruthy();
  expect(block.querySelectorAll("ul")).toHaveLength(0);
});
