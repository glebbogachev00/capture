// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as imgCache from "@/lib/imgCache";
import { EMPTY, IMG, KEY, type Action, type Board } from "@/lib/model";
import { del, get, keys, set } from "@/lib/storage";
import { TOMBSTONE_KEY } from "@/lib/sync";
import { useBoard } from "./useBoard";

const NOW = 1_789_286_400_000;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=";
const action: Action = {
  id: "pictured-action",
  text: "Keep the restored picture",
  src: "Keep the restored picture",
  done: false,
  at: NOW,
  shelf: "keep",
  expires: null,
  imgs: ["picture"],
};

type DeletePath = "toggleAction" | "removeUnsorted";

function boardFor(path: DeletePath): Board {
  if (path === "toggleAction") return { ...EMPTY, actions: [action] };
  return {
    ...EMPTY,
    actions: [{ ...action, unsorted: true }],
    ledger: [{
      id: "pending-record",
      at: NOW,
      raw: action.src!,
      clean: action.text,
      kind: "pending",
      source: "typed",
      targetId: action.id,
      imgs: ["picture"],
    }],
  };
}

beforeEach(async () => {
  localStorage.clear();
  for (const key of await keys()) await del(key);
  imgCache._clearImgCache();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each<DeletePath>(["toggleAction", "removeUnsorted"])(
  "%s image deletion versus backup restore",
  (path) => {
    it("queues restore behind the delayed deletion and keeps the restored bytes", async () => {
      const originalDrop = imgCache.imgDrop;
      let announceDrop!: () => void;
      const dropStarted = new Promise<void>((resolve) => { announceDrop = resolve; });
      let releaseDrop!: () => void;
      const dropHeld = new Promise<void>((resolve) => { releaseDrop = resolve; });
      vi.spyOn(imgCache, "imgDrop").mockImplementation(async (id) => {
        announceDrop();
        await dropHeld;
        await originalDrop(id);
      });

      const source = boardFor(path);
      await set(KEY, JSON.stringify(source));
      await set(TOMBSTONE_KEY, JSON.stringify([]));
      await imgCache.imgSave("picture", PNG);
      const hook = renderHook(() => useBoard(NOW + 60_000));
      await waitFor(() => expect(hook.result.current.loaded).toBe(true));

      let mutation!: Promise<unknown>;
      act(() => {
        mutation = path === "toggleAction"
          ? hook.result.current.toggleAction(action.id)
          : hook.result.current.removeUnsorted(hook.result.current.data.actions[0]);
      });
      await dropStarted;
      await waitFor(() => {
        expect(hook.result.current.data.actions.some((item) => item.id === action.id)).toBe(false);
      });

      let fileReads = 0;
      const file = {
        name: "pictured-backup.json",
        text: async () => {
          fileReads++;
          return JSON.stringify({
            app: "capture",
            version: 2,
            board: source,
            images: { picture: PNG },
          });
        },
      } as File;
      let restore!: Promise<void>;
      act(() => { restore = hook.result.current.restoreFromFile(file); });
      await Promise.resolve();

      expect(fileReads).toBe(0);
      expect(await get(IMG("picture"))).toBe(PNG);

      releaseDrop();
      await act(async () => { await Promise.all([mutation, restore]); });

      expect(fileReads).toBe(1);
      expect(hook.result.current.ioNote).toMatchObject({ ok: true });
      expect(hook.result.current.data.actions.some((item) => item.id === action.id)).toBe(true);
      expect(await get(IMG("picture"))).toBe(PNG);
    });
  },
);
