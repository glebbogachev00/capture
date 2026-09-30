// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureProfile } from "@/components/CaptureProfile";
import { EMPTY, KEY, type Board } from "@/lib/model";
import { get, set } from "@/lib/storage";
import { TOMBSTONE_KEY } from "@/lib/sync";
import { toggleIntentionPin } from "@/lib/intentionShowcasePrefs";
import { useBoard } from "./useBoard";

const initialProfile = {
  name: "Ada", showSignature: true, intentionShowcaseEnabled: true,
  pinnedIntentionIds: [] as string[], intentionShowcaseCollapsed: true, updatedAt: 12,
};
let posts: Board[];

beforeEach(async () => {
  localStorage.clear();
  posts = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/api/sync") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { board: Board };
      posts.push(body.board);
      return new Response(JSON.stringify({ board: body.board, tombstones: [], rev: posts.length }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    // All other requests fail locally; no test can contact a real API.
    return new Response("", { status: 503 });
  }));
  await set(KEY, JSON.stringify({ ...EMPTY, profile: initialProfile }));
  await set(TOMBSTONE_KEY, "[]");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function storedBoard(): Promise<Board> {
  return JSON.parse((await get(KEY))!);
}

describe("atomic showcase profile edits through useBoard", () => {
  it("Record name editing changes only the name against the latest profile", async () => {
    const onProfileChange = vi.fn().mockResolvedValue(undefined);
    render(createElement(CaptureProfile, {
      threads: [], onOpenThread: () => {}, defaults: { name: "", image: "" },
      profile: initialProfile, onProfileChange,
    }));
    fireEvent.change(screen.getByRole("textbox", { name: "Your name" }), { target: { value: "Grace" } });
    expect(onProfileChange).toHaveBeenCalledTimes(1);
    const update = onProfileChange.mock.calls[0][0];
    expect(update).toEqual(expect.any(Function));
    const latest = { ...initialProfile, imageId: "new-photo", showSignature: false,
      pinnedIntentionIds: ["A", "B"], intentionShowcaseEnabled: false,
      intentionShowcaseCollapsed: false };
    expect(update(latest)).toEqual({ ...latest, name: "Grace" });
  });
  it("enabling a legacy profile starts with no pins and saves collapse changes", async () => {
    await set(KEY, JSON.stringify({ ...EMPTY, profile: { name: "Ada" } }));
    const { result, unmount } = renderHook(() => useBoard(Date.now()));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.data.profile?.intentionShowcaseEnabled ?? false).toBe(false);
    expect(result.current.data.profile?.pinnedIntentionIds ?? []).toEqual([]);
    await act(async () => {
      await Promise.all([
        result.current.updateProfile((current) => ({ ...current, intentionShowcaseEnabled: true })),
        result.current.updateProfile((current) => ({ ...current, intentionShowcaseCollapsed: true })),
      ]);
    });
    expect((await storedBoard()).profile).toMatchObject({ intentionShowcaseEnabled: true, intentionShowcaseCollapsed: true });
    expect((await storedBoard()).profile?.pinnedIntentionIds ?? []).toEqual([]);
    unmount();
    const reloaded = renderHook(() => useBoard(Date.now()));
    await waitFor(() => expect(reloaded.result.current.loaded).toBe(true));
    expect(reloaded.result.current.data.profile).toMatchObject({ intentionShowcaseEnabled: true, intentionShowcaseCollapsed: true });
    expect(reloaded.result.current.data.profile?.pinnedIntentionIds ?? []).toEqual([]);
  });

  it("retains rapid pin A plus pin B in memory, storage, and sync", async () => {
    const { result } = renderHook(() => useBoard(Date.now()));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => {
      await Promise.all([
        result.current.updateProfile((current) => toggleIntentionPin(current, "A")),
        result.current.updateProfile((current) => toggleIntentionPin(current, "B")),
      ]);
    });
    expect(result.current.data.profile).toMatchObject({ ...initialProfile,
      pinnedIntentionIds: ["A", "B"], updatedAt: expect.any(Number) });
    expect(result.current.data.profile!.updatedAt).toBeGreaterThan(initialProfile.updatedAt);
    expect((await storedBoard()).profile).toEqual(result.current.data.profile);
    await waitFor(() => expect(posts.length).toBeGreaterThan(0), { timeout: 4000 });
    expect(posts.at(-1)?.profile).toEqual(result.current.data.profile);
  });

  it("rapid double-toggle A leaves it unpinned", async () => {
    const { result } = renderHook(() => useBoard(Date.now()));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => {
      await Promise.all([
        result.current.updateProfile((current) => toggleIntentionPin(current, "A")),
        result.current.updateProfile((current) => toggleIntentionPin(current, "A")),
      ]);
    });
    expect(result.current.data.profile?.pinnedIntentionIds).toEqual([]);
    expect((await storedBoard()).profile?.pinnedIntentionIds).toEqual([]);
  });

  it("disabling and editing the name retain pins and collapse across reload", async () => {
    const first = renderHook(() => useBoard(Date.now()));
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    await act(async () => {
      await first.result.current.updateProfile((current) => toggleIntentionPin(current, "A"));
      await first.result.current.updateProfile((current) => ({ ...current, intentionShowcaseEnabled: false }));
      await first.result.current.updateProfile((current) => ({ ...current, name: "Grace" }));
    });
    const expected = { ...initialProfile, name: "Grace", intentionShowcaseEnabled: false,
      pinnedIntentionIds: ["A"], updatedAt: expect.any(Number) };
    expect((await storedBoard()).profile).toMatchObject(expected);
    first.unmount();
    const second = renderHook(() => useBoard(Date.now()));
    await waitFor(() => expect(second.result.current.loaded).toBe(true));
    expect(second.result.current.data.profile).toMatchObject(expected);
  });
});
