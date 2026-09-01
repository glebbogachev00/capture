// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { set } from "@/lib/storage";
import { KEY, type Board } from "@/lib/model";
import { useBoard } from "./useBoard";

/**
 * The hook itself, running — not a grep of its source.
 *
 * Every seam module is behavior-tested on its own, but until this file
 * nothing proved the WIRING: that a real edit made through the real hook,
 * against real (fake-indexeddb) storage, actually reaches /api/sync — and
 * that the one race the push governor exists for cannot recur through the
 * hook's own plumbing. The incident this pins: an edit made while a push
 * was in flight hit the old `if (syncing) return` guard and its push was
 * silently dropped; on a phone pocketed right after a capture, the edit
 * reached the hub hours late or never.
 *
 * The staging is entirely at the fetch boundary: the first push is HELD
 * (an unresolved promise we control), the second edit lands while it
 * hangs, and the test asserts the hub still receives everything.
 */

const T0 = 1_756_000_000_000;

function seedBoard(): Board {
  return {
    actions: [
      {
        id: "a1",
        text: "Record a Retake demo of the new features",
        done: false,
        at: T0,
        shelf: "keep",
        expires: null,
      },
      {
        id: "a2",
        text: "Rotate the Upstash token",
        done: false,
        at: T0 + 1000,
        shelf: "keep",
        expires: null,
      },
    ],
    threads: [],
    intentions: [],
    principles: [],
  } as unknown as Board;
}

type Held = { resolve: (body: unknown) => void };

function mockSync() {
  const posts: { body: { board: Board } ; held: boolean }[] = [];
  let hold: Held | null = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("/api/sync")) {
      return new Response(JSON.stringify({ error: "off" }), { status: 503 });
    }
    if (!init || init.method !== "POST") {
      // Pulls and polls: hub quiet, nothing to merge.
      return new Response("", { status: 503 });
    }
    const body = JSON.parse(String(init.body)) as { board: Board };
    const first = posts.length === 0;
    posts.push({ body, held: first });
    if (first) {
      // Hold the first push in flight until the test releases it.
      return new Promise<Response>((resolve) => {
        hold = {
          resolve: (reply: unknown) =>
            resolve(
              new Response(JSON.stringify(reply), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              })
            ),
        };
      });
    }
    return new Response(
      JSON.stringify({ board: body.board, tombstones: [], rev: posts.length }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;
  return {
    posts,
    release: () =>
      hold?.resolve({ board: posts[0].body.board, tombstones: [], rev: 1 }),
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

describe("the real hook, pushing to the real seam", () => {
  let sync: ReturnType<typeof mockSync>;
  beforeEach(async () => {
    sync = mockSync();
    await set(KEY, JSON.stringify(seedBoard()));
  });
  afterEach(() => sync.restore());

  it("an edit made during an in-flight push still reaches the hub", async () => {
    const { result, unmount } = renderHook(() => useBoard(T0 + 60_000));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.data.actions).toHaveLength(2);

    // First edit: tick an action. Its push departs after the debounce and
    // HANGS at the fetch boundary.
    await act(async () => {
      await result.current.toggleAction("a1");
    });
    await waitFor(() => expect(sync.posts).toHaveLength(1), {
      timeout: 4000,
    });

    // Second edit while the first push is in flight — the exact shipped
    // race. Its debounce timer will fire into the busy governor.
    await act(async () => {
      await result.current.toggleAction("a2");
    });
    // Give the debounce time to fire into the in-flight run; the edit must
    // be HELD, not sent as an overlapping push and not dropped.
    await new Promise((r) => setTimeout(r, 1600));
    expect(sync.posts).toHaveLength(1);

    // The first push completes; the held edit must drain on its own.
    await act(async () => {
      sync.release();
    });
    await waitFor(() => expect(sync.posts).toHaveLength(2), {
      timeout: 4000,
    });

    // The drained push carries the FULL outcome of both edits: both rows
    // ticked off the board, both completion receipts kept.
    const finalBoard = sync.posts[1].body.board;
    expect(finalBoard.actions).toHaveLength(0);
    expect((finalBoard.completions ?? []).map((c) => c.id).sort()).toEqual([
      "a1",
      "a2",
    ]);
    unmount();
  });

  it("an unchanged push reply keeps the current board identity", async () => {
    const { result, unmount } = renderHook(() => useBoard(T0 + 60_000));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.toggleAction("a1");
    });
    const afterEdit = result.current.data;
    await waitFor(() => expect(sync.posts).toHaveLength(1), {
      timeout: 4000,
    });

    await act(async () => {
      sync.release();
    });
    await waitFor(() => expect(result.current.sync?.ok).toBe(true));

    expect(result.current.data).toBe(afterEdit);
    unmount();
  });
});
