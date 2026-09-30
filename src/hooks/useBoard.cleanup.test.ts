// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as imgCache from "@/lib/imgCache";
import { removePhotos } from "@/lib/cleanup";
import { EMPTY, IMG, KEY, type Board } from "@/lib/model";
import { del, get, keys, set } from "@/lib/storage";
import { TOMBSTONE_KEY } from "@/lib/sync";
import { useBoard } from "./useBoard";

const NOW = 1_789_286_400_000;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=";
const source: Board = {
  ...EMPTY,
  threads: [{ id: "t", name: "Kitchen", summary: "", frags: [
    { id: "f1", text: "the old tap", at: NOW - 9e9, imgs: ["old"] },
    { id: "f2", text: "(image only)", at: NOW - 8e9, imgs: ["gone"] },
  ] }],
};

beforeEach(async () => {
  localStorage.clear();
  for (const key of await keys()) await del(key);
  imgCache._clearImgCache();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("lands a photo clean-up as one change with one Undo, and keeps the bytes until Undo can't run", async () => {
  await set(KEY, JSON.stringify(source));
  await set(TOMBSTONE_KEY, JSON.stringify([]));
  await imgCache.imgSave("old", PNG);
  await imgCache.imgSave("gone", PNG);
  const hook = renderHook(() => useBoard(NOW));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));

  await act(async () => { await hook.result.current.applyCleanup((b) => removePhotos(b, ["old", "gone"], NOW)); });
  const frags = () => hook.result.current.data.threads[0]?.frags ?? [];
  expect(frags().map((f) => [f.id, f.imgs])).toEqual([["f1", []]]);
  expect(hook.result.current.notice).toBe("Removed 2 photos and 1 photo-only note. The words stay.");
  expect(hook.result.current.noticeUndoable).toBe(true);
  // Held for the Undo, not destroyed.
  expect(await get(IMG("old"))).toBe(PNG);

  await act(async () => { await hook.result.current.undo(); });
  expect(frags().map((f) => [f.id, f.imgs])).toEqual([["f1", ["old"]], ["f2", ["gone"]]]);
  expect(await get(IMG("gone"))).toBe(PNG);
});

it("destroys the bytes once a later change retires that Undo", async () => {
  await set(KEY, JSON.stringify(source));
  await set(TOMBSTONE_KEY, JSON.stringify([]));
  await imgCache.imgSave("old", PNG);
  await imgCache.imgSave("gone", PNG);
  const hook = renderHook(() => useBoard(NOW));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));

  await act(async () => { await hook.result.current.applyCleanup((b) => removePhotos(b, ["old"], NOW)); });
  await act(async () => { await hook.result.current.applyCleanup((b) => removePhotos(b, ["gone"], NOW)); });
  await waitFor(async () => expect(await get(IMG("old"))).toBeNull());
  // The newest batch is still undoable, so its photo is still held.
  expect(await get(IMG("gone"))).toBe(PNG);
});
