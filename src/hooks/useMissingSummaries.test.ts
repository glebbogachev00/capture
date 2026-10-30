// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Thread } from "@/lib/model";
import { useMissingSummaries } from "./useMissingSummaries";

const thread = (id: string, over: Partial<Thread> = {}): Thread =>
  ({ id, name: id, summary: "", frags: [{ id: `${id}-f`, at: 1, text: "a note" }], ...over });

it("asks once per opening for each thread with notes and no description", () => {
  const summarize = vi.fn();
  const threads = [
    thread("mountain-lion"),
    thread("ovid", { summary: "A cozy platformer." }),
    thread("empty", { frags: [] }),
    thread("temporary", { name: "Temporary — Plan the release", temporaryName: true }),
    /* Flagged, but the person named it: a real thread (the Mountain Lion bug). */
    thread("named", { name: "Mountain Lion", temporaryName: true }),
  ];
  const { rerender } = renderHook(({ list }) => useMissingSummaries(true, list, summarize), { initialProps: { list: threads } });
  expect(summarize.mock.calls).toEqual([["mountain-lion"], ["named"]]);
  rerender({ list: [...threads, thread("conversations")] });
  expect(summarize.mock.calls).toEqual([["mountain-lion"], ["named"], ["conversations"]]);
});

it("waits for the board to load", () => {
  const summarize = vi.fn();
  renderHook(() => useMissingSummaries(false, [thread("mountain-lion")], summarize));
  expect(summarize).not.toHaveBeenCalled();
});
