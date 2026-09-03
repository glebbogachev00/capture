// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { KEY, EMPTY, type Board } from "@/lib/model";
import { set } from "@/lib/storage";
import { useBoard } from "./useBoard";

const NOW = 1_756_000_000_000;

function largeBoard(): Board {
  return {
    ...EMPTY,
    actions: Array.from({ length: 100 }, (_, index) => ({
      id: `action-${index}`,
      text: `Review the Capture performance report item ${index} before mobile release`,
      done: false,
      at: NOW - index,
      shelf: "keep" as const,
      expires: null,
    })),
    threads: Array.from({ length: 30 }, (_, threadIndex) => ({
      id: `thread-${threadIndex}`,
      name: `Performance thread ${threadIndex}`,
      summary: "",
      frags: Array.from({ length: 10 }, (_, fragIndex) => ({
        id: `fragment-${threadIndex}-${fragIndex}`,
        at: NOW - fragIndex,
        text: `Capture performance context ${threadIndex} ${fragIndex} for the mobile board`,
      })),
    })),
    completions: Array.from({ length: 500 }, (_, index) => ({
      id: `receipt-${index}`,
      text: `Completed Capture performance task ${index} after the mobile review`,
      at: NOW - index,
    })),
  };
}

describe("large-board action interaction", () => {
  const realFetch = globalThis.fetch;

  beforeEach(async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    await set(KEY, JSON.stringify(largeBoard()));
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("keeps twenty real hook ticks under 500ms while the board continues to update", async () => {
    const { result, unmount } = renderHook(() => useBoard(NOW + 60_000));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    const started = performance.now();
    for (let index = 0; index < 20; index++) {
      await act(async () => {
        await result.current.toggleAction(`action-${index}`);
      });
      expect(result.current.data.actions).toHaveLength(99 - index);
    }
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(500);
    unmount();
  });
});
