// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { set } from "@/lib/storage";
import { EMPTY, KEY, type Board } from "@/lib/model";
import { useBoard } from "./useBoard";
import { TOMBSTONE_KEY } from "@/lib/sync";
import { imgLoad, imgSave } from "@/lib/imgCache";

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
    await set(TOMBSTONE_KEY, "[]");
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

  it("pushes a profile edit through the board sync path", async () => {
    const { result, unmount } = renderHook(() => useBoard(T0 + 60_000));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.updateProfile({
        name: "Gleb",
        imageId: "profile-photo",
        showSignature: true,
      });
    });

    await waitFor(() => expect(sync.posts).toHaveLength(1), {
      timeout: 4000,
    });
    expect(sync.posts[0].body.board.profile).toMatchObject({
      name: "Gleb",
      imageId: "profile-photo",
      showSignature: true,
    });

    await act(async () => sync.release());
    unmount();
  });

  it("retries a missing profile photo when the board revision is unchanged", async () => {
    sync.restore();
    const withProfile = {
      ...seedBoard(),
      profile: {
        name: "Gleb",
        imageId: "retry-profile-photo",
        showSignature: true,
        updatedAt: T0,
      },
    };
    await set(KEY, JSON.stringify(withProfile));
    let syncGets = 0;
    let imageGets = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/img/retry-profile-photo")) {
        imageGets++;
        return imageGets === 1
          ? new Response("", { status: 503 })
          : new Response(
              JSON.stringify({ src: "data:image/webp;base64,RETRY" }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
      }
      if (url.includes("/api/sync") && (!init || init.method !== "POST")) {
        syncGets++;
        return new Response(
          JSON.stringify(
            syncGets === 1
              ? { board: withProfile, tombstones: [], rev: 1 }
              : { unchanged: true, rev: 1 }
          ),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("", { status: 503 });
    }) as typeof fetch;

    const { unmount } = renderHook(() => useBoard(T0 + 60_000));
    await waitFor(() => expect(imageGets).toBe(1));

    act(() => window.dispatchEvent(new Event("focus")));

    await waitFor(() => expect(syncGets).toBe(2));
    await waitFor(() => expect(imageGets).toBe(2));
    unmount();
  });

  it("restores profile photo bytes from a Capture backup", async () => {
    const { result, unmount } = renderHook(() => useBoard(T0 + 60_000));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const src = "data:image/webp;base64,PROFILE-BACKUP";
    const file = {
      name: "capture-backup.json",
      text: async () =>
        JSON.stringify({
          app: "capture",
          version: 2,
          exportedAt: new Date(T0).toISOString(),
          board: {
            actions: [],
            threads: [],
            intentions: [],
            principles: [],
            ledger: [],
            corrections: [],
            profile: {
              name: "Gleb",
              imageId: "backup-profile-photo",
              showSignature: true,
              updatedAt: T0,
            },
          },
          images: { "backup-profile-photo": src },
        }),
    } as File;

    await act(async () => result.current.restoreFromFile(file));

    expect(result.current.data.profile?.imageId).toBe("backup-profile-photo");
    expect(await imgLoad("backup-profile-photo")).toBe(src);
    unmount();
  });

  it("schedules one hub push after a successful local v3 restore", async () => {
    const { result, unmount } = renderHook(() => useBoard(T0 + 60_000));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const { buildBackup } = await import("@/lib/backup");
    const restored = {
      ...EMPTY,
      ...seedBoard(),
      threads: [{
        id: "restored-thread", name: "Restored for hub", summary: "",
        frags: [{ id: "restored-frag", text: "Push this restored fragment", at: T0 + 2 }],
      }],
    };
    const file = {
      name: "local-v3.json",
      text: async () => JSON.stringify(buildBackup(restored, {}, [], { kind: "local" })),
    } as File;

    await act(async () => { await result.current.restoreFromFile(file); });
    await waitFor(() => expect(sync.posts).toHaveLength(1), { timeout: 4000 });
    expect(JSON.stringify(sync.posts[0].body.board)).toContain("Push this restored fragment");
    await act(async () => { sync.release(); });
    await new Promise((resolve) => setTimeout(resolve, 1700));
    expect(sync.posts).toHaveLength(1);
    unmount();
  });

  it("does not report full sync for an over-envelope original and confirms only a remotely present copy", async () => {
    sync.restore();
    const oversized = "data:image/png;base64," + "A".repeat(3_100_000);
    const withImage = {
      ...seedBoard(),
      actions: [{ ...seedBoard().actions[0], imgs: ["oversized-photo"] }],
    };
    await set(KEY, JSON.stringify(withImage));
    await imgSave("oversized-photo", oversized);
    let uploaded = false;
    let puts = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/img/oversized-photo" && init?.method === "HEAD") {
        return new Response(null, { status: uploaded ? 204 : 404 });
      }
      if (url === "/api/img/oversized-photo" && init?.method === "PUT") {
        puts++;
        return new Response(null, { status: 200 });
      }
      if (url.startsWith("/api/sync") && init?.method === "POST") {
        return Response.json({ board: withImage, tombstones: [], rev: 1 });
      }
      if (url.startsWith("/api/sync")) {
        return Response.json({ board: withImage, tombstones: [], rev: 1 });
      }
      return new Response(null, { status: 503 });
    }) as typeof fetch;

    const first = renderHook(() => useBoard(T0 + 60_000));
    await waitFor(() => expect(first.result.current.sync).toMatchObject({
      ok: false,
      imageSync: "failed",
      note: "An image is too large to sync — kept locally",
    }));
    expect(puts).toBe(0);
    expect(await imgLoad("oversized-photo")).toBe(oversized);

    await act(async () => { await first.result.current.syncNow(); });
    expect(first.result.current.sync).toMatchObject({ ok: false, imageSync: "failed" });
    expect(puts).toBe(0);

    uploaded = true;
    await act(async () => { await first.result.current.syncNow(); });
    await waitFor(() => expect(first.result.current.sync?.ok).toBe(true));
    expect(puts).toBe(0);
    first.unmount();

    const reloaded = renderHook(() => useBoard(T0 + 60_000));
    await waitFor(() => expect(reloaded.result.current.sync?.ok).toBe(true));
    expect(puts).toBe(0);
    expect(await imgLoad("oversized-photo")).toBe(oversized);
    reloaded.unmount();
  });

  it("keeps mixed image reconciliation incomplete and retries only the failed upload", async () => {
    sync.restore();
    const withImages = {
      ...seedBoard(),
      actions: [{ ...seedBoard().actions[0], imgs: ["good-photo", "failed-photo"] }],
    };
    await set(KEY, JSON.stringify(withImages));
    await imgSave("good-photo", "data:image/jpeg;base64,GOOD");
    await imgSave("failed-photo", "data:image/png;base64,TOO-LARGE");
    const puts = new Map<string, number>();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/sync")) {
        return Response.json({ board: withImages, tombstones: [], rev: 1 });
      }
      if (url.startsWith("/api/img/") && init?.method === "HEAD") {
        return new Response(null, { status: 404 });
      }
      if (url.startsWith("/api/img/") && init?.method === "PUT") {
        const id = url.split("/").at(-1)!;
        puts.set(id, (puts.get(id) ?? 0) + 1);
        return new Response(null, { status: id === "good-photo" ? 200 : 413 });
      }
      return new Response(null, { status: 503 });
    }) as typeof fetch;

    const hook = renderHook(() => useBoard(T0 + 60_000));
    await waitFor(() => expect(puts.get("failed-photo")).toBe(1));
    await waitFor(() => expect(hook.result.current.sync).toMatchObject({
      ok: false,
      imageSync: "failed",
    }));
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(puts.get("failed-photo")).toBe(2));
    expect(puts.get("good-photo")).toBe(1);
    hook.unmount();
  });

  it("does not report sync until a remotely referenced missing image is fetched and stored", async () => {
    sync.restore();
    const remote = {
      ...seedBoard(),
      actions: [{ ...seedBoard().actions[0], imgs: ["remote-photo"], updatedAt: T0 + 10_000 }],
    };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/sync")) {
        return Response.json({ board: remote, tombstones: [], rev: 1 });
      }
      if (url === "/api/img/remote-photo") {
        return Response.json({ src: "data:image/jpeg;base64,REMOTE" });
      }
      return new Response(null, { status: 503 });
    }) as typeof fetch;

    const hook = renderHook(() => useBoard(T0 + 60_000));
    await waitFor(() => expect(hook.result.current.sync?.ok).toBe(true));
    expect(await imgLoad("remote-photo")).toBe("data:image/jpeg;base64,REMOTE");
    hook.unmount();
  });
});
