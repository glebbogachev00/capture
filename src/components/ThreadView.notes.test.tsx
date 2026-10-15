// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThreadView } from "./ThreadView";
import type { Thread } from "@/lib/model";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function props(thread: Thread) {
  return { thread, others: [], fromActions: { open: [], done: [] }, busy: false,
    onBack: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onRefreshSummary: vi.fn(),
    onEditFrag: vi.fn(), onEditFrags: vi.fn(), onDeleteFrag: vi.fn(), onMerge: vi.fn(), onSetCover: vi.fn(),
    onMoveFrag: vi.fn(), onMoveFragToNew: vi.fn(), onCopyThread: vi.fn(), onCopyFrag: vi.fn(),
    onExtractAction: vi.fn(), onResolveFrag: vi.fn(), onAddFragImages: vi.fn(), onTakeNext: vi.fn(), onDismissNext: vi.fn() };
}
const paragraph = (topic: string) =>
  `This part is about ${topic} and it goes on for a while, because I keep thinking out loud about it. ` +
  `There is a lot to say about ${topic}, so I say it, and then I say a bit more about why ${topic} matters to me right now.`;
const long = ["launch", "launch", "pricing", "pricing", "the team", "the team"].map(paragraph).join("\n\n");

it("shows a note's headings and lists as a laid-out page, never as markup", () => {
  const thread: Thread = { id: "t", name: "Plans", summary: "", frags: [{ id: "f", at: 1, text: "### The launch\n\nThree things:\n- one\n- two" }] };
  const { container } = render(<ThreadView {...props(thread)} />);
  expect(screen.getByRole("heading", { name: "The launch" })).toBeTruthy();
  expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["one", "two"]);
  expect(container.querySelector(".frag-text")?.textContent).not.toContain("###");
});

it("offers headings for a long older note once, and saves them when they come back", async () => {
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
    const { texts } = JSON.parse(String(init?.body)) as { texts: string[] };
    return Response.json({ texts: texts.map((text) => `### The launch\n\n${text}`) });
  });
  vi.stubGlobal("fetch", fetchMock);
  const thread: Thread = { id: "t", name: "Plans", summary: "", frags: [{ id: "f", at: 1, text: long }] };
  const p = props(thread);
  render(<ThreadView {...p} />);
  fireEvent.click(screen.getAllByRole("button", { name: "More options" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Format" }));
  await waitFor(() => expect(p.onEditFrags).toHaveBeenCalledWith([{ fragId: "f", text: `### The launch\n\n${long}` }]));
  expect(fetchMock.mock.calls[0][0]).toBe("/api/format");
});

it("does not offer Format again for a long note the model read as one thought", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_url, init) => Response.json(JSON.parse(String(init?.body)))));
  const thread: Thread = { id: "t", name: "Plans", summary: "", frags: [{ id: "f", at: 1, text: long }] };
  const p = props(thread);
  const view = render(<ThreadView {...p} />);
  fireEvent.click(screen.getAllByRole("button", { name: "More options" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Format" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Format" })).toBeNull());
  expect(p.onEditFrags).not.toHaveBeenCalled();
  view.unmount();
  render(<ThreadView {...p} />);
  fireEvent.click(screen.getAllByRole("button", { name: "More options" })[0]);
  expect(screen.queryByRole("button", { name: "Format" })).toBeNull();
});
