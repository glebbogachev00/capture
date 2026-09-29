/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Capture } from "@/app/Capture";
import { buildBackup } from "@/lib/backup";
import { EMPTY, IMG, KEY, type Board } from "@/lib/model";
import { get, keys, del, set } from "@/lib/storage";
import { mergeSync, TOMBSTONE_KEY, type Tombstone } from "@/lib/sync";
import { useBoard } from "@/hooks/useBoard";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=";
const PHOTO = "owner-photo";

function ownerBoard(): Board {
  return {
    ...EMPTY,
    principles: [],
    actions: [{
      id: "image-action",
      text: "Publish the image-backed release note",
      done: false,
      at: 10,
      updatedAt: 10,
      shelf: "keep",
      expires: null,
      imgs: [],
      shot: { threadId: "source", fragId: "owner-frag" },
    }],
    threads: [
      {
        id: "source",
        name: "Source",
        summary: "",
        updatedAt: 10,
        frags: [{
          id: "owner-frag",
          at: 10,
          updatedAt: 10,
          text: "The durable image owner",
          imgs: [PHOTO],
        }],
      },
      {
        id: "destination",
        name: "Destination",
        summary: "",
        updatedAt: 10,
        frags: [{ id: "destination-frag", at: 5, updatedAt: 5, text: "Existing note" }],
      },
    ],
    ledger: [{
      id: "image-ledger",
      at: 10,
      raw: "Publish the image-backed release note",
      clean: "Publish the image-backed release note",
      kind: "action",
      source: "image",
      targetId: "image-action",
      targetFragId: "owner-frag",
      imgs: [PHOTO],
      settledBy: "manual",
    }],
  };
}

beforeEach(async () => {
  for (const key of await keys()) await del(key);
  await set(KEY, JSON.stringify(ownerBoard()));
  await set(TOMBSTONE_KEY, "[]");
  await set(IMG(PHOTO), PNG);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount() {
  const hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  return hook;
}

type OwnerOperation = "move" | "split" | "merge";

async function applyOperation(
  hook: Awaited<ReturnType<typeof mount>>,
  operation: OwnerOperation,
) {
  if (operation === "move") {
    expect(await hook.result.current.moveFrag("source", "owner-frag", "destination")).toBe(true);
  } else if (operation === "split") {
    expect(await hook.result.current.moveFragToNew("source", "owner-frag")).toBe(true);
  } else {
    expect(await hook.result.current.mergeThreads("destination", "source")).toBe(true);
  }
}

describe("manual Action image-owner moves", () => {
  it.each(["move", "split", "merge"] as const)(
    "%s keeps the rendered link, completion, reload, sync and backup on the moved owner",
    async (operation) => {
      const stale = ownerBoard();
      const hook = await mount();
      await act(async () => { await applyOperation(hook, operation); });

      const action = hook.result.current.data.actions.find((item) => item.id === "image-action")!;
      const pointer = action.shot!;
      expect(pointer.threadId).not.toBe("source");
      const owner = hook.result.current.data.threads
        .find((thread) => thread.id === pointer.threadId)
        ?.frags.find((frag) => frag.id === pointer.fragId);
      expect(owner?.imgs).toEqual([PHOTO]);

      const persisted = JSON.parse((await get(KEY))!) as Board;
      expect(persisted.actions.find((item) => item.id === action.id)?.shot).toEqual(pointer);
      const tombstones = JSON.parse((await get(TOMBSTONE_KEY))!) as Tombstone[];
      const synced = mergeSync(
        { board: stale, tombstones: [] },
        { board: persisted, tombstones },
        Date.now() + 100,
      );
      expect(synced.board.actions.find((item) => item.id === action.id)?.shot).toEqual(pointer);
      expect(synced.board.threads.find((thread) => thread.id === pointer.threadId)
        ?.frags.some((frag) => frag.id === pointer.fragId)).toBe(true);

      const backup = buildBackup(persisted, { [PHOTO]: PNG }, tombstones);
      expect(backup.board.actions.find((item) => item.id === action.id)?.shot).toEqual(pointer);
      expect(backup.images[PHOTO]).toBe(PNG);

      hook.unmount();
      const view = render(<Capture />);
      await screen.findByText("Publish the image-backed release note");
      fireEvent.click(screen.getByRole("button", { name: "picture" }));
      await waitFor(() => expect(
        view.container.querySelector('.frag[aria-current="true"]')?.textContent
      ).toContain("The durable image owner"));
      view.unmount();

      const reloaded = await mount();
      expect(reloaded.result.current.data.actions.find((item) => item.id === action.id)?.shot)
        .toEqual(pointer);
      await act(async () => { await reloaded.result.current.toggleAction(action.id); });
      expect(reloaded.result.current.data.actions.some((item) => item.id === action.id)).toBe(false);
      expect(reloaded.result.current.data.completions).toEqual([
        expect.objectContaining({ id: action.id, text: action.text }),
      ]);
      expect(reloaded.result.current.data.threads.find((thread) => thread.id === pointer.threadId)
        ?.frags.find((frag) => frag.id === pointer.fragId)?.imgs).toEqual([PHOTO]);
      expect(await get(IMG(PHOTO))).toBe(PNG);
    },
  );

  it("keeps a stale-device Action edit linked and deletion-protected after sync reconciliation", async () => {
    const stale = ownerBoard();
    stale.actions[0] = {
      ...stale.actions[0],
      text: "Newer wording from the stale device",
      updatedAt: 30,
      shot: { threadId: "source", fragId: "owner-frag" },
    };
    const moved = ownerBoard();
    moved.actions[0] = {
      ...moved.actions[0],
      updatedAt: 20,
      shot: { threadId: "destination", fragId: "owner-frag" },
    };
    const owner = moved.threads[0].frags[0];
    moved.threads = [{
      ...moved.threads[1],
      updatedAt: 20,
      frags: [...moved.threads[1].frags, { ...owner, updatedAt: 20 }],
    }];
    const tombstones: Tombstone[] = [{ kind: "thread", id: "source", deletedAt: 20 }];
    const merged = mergeSync(
      { board: stale, tombstones: [] },
      { board: moved, tombstones },
      40,
    );
    expect(merged.board.actions[0]).toMatchObject({
      text: "Newer wording from the stale device",
      updatedAt: 30,
      shot: { threadId: "destination", fragId: "owner-frag" },
    });
    expect(merged.board.ledger).toEqual(stale.ledger);
    expect(merged.board.threads[0].frags.find((frag) => frag.id === "owner-frag")?.imgs)
      .toEqual([PHOTO]);

    await set(KEY, JSON.stringify(merged.board));
    await set(TOMBSTONE_KEY, JSON.stringify(merged.tombstones));
    const view = render(<Capture />);
    await screen.findByText("Newer wording from the stale device");
    fireEvent.click(screen.getByRole("button", { name: "picture" }));
    await waitFor(() => expect(
      view.container.querySelector('.frag[aria-current="true"]')?.textContent
    ).toContain("The durable image owner"));
    view.unmount();

    const hook = await mount();
    let removed: unknown;
    await act(async () => {
      removed = await hook.result.current.deleteFrag("destination", "owner-frag");
    });
    expect(removed).toBe(false);
    expect(await get(IMG(PHOTO))).toBe(PNG);
    expect(hook.result.current.data.ledger).toEqual(stale.ledger);
    hook.unmount();
  });
});

describe("manual owner deletion", () => {
  it.each(["fragment", "thread"] as const)(
    "blocks %s deletion while the Action is live, then preserves ledger bytes after completion",
    async (kind) => {
      const hook = await mount();
      let blocked: unknown;
      await act(async () => {
        blocked = kind === "fragment"
          ? await hook.result.current.deleteFrag("source", "owner-frag")
          : await hook.result.current.deleteThread("source");
      });
      expect(blocked).toBe(false);
      expect(hook.result.current.data.actions[0].shot)
        .toEqual({ threadId: "source", fragId: "owner-frag" });
      expect(hook.result.current.data.threads.find((thread) => thread.id === "source")
        ?.frags[0].imgs).toEqual([PHOTO]);
      expect(await get(IMG(PHOTO))).toBe(PNG);

      await act(async () => { await hook.result.current.toggleAction("image-action"); });
      let removed: unknown;
      await act(async () => {
        removed = kind === "fragment"
          ? await hook.result.current.deleteFrag("source", "owner-frag")
          : await hook.result.current.deleteThread("source");
      });
      expect(removed).toBe(true);
      expect(hook.result.current.data.threads.some((thread) => thread.id === "source")).toBe(false);
      expect(hook.result.current.data.ledger[0].imgs).toEqual([PHOTO]);
      expect(await get(IMG(PHOTO))).toBe(PNG);

      const archive = buildBackup(hook.result.current.data, { [PHOTO]: (await get(IMG(PHOTO)))! });
      expect(archive.images[PHOTO]).toBe(PNG);
      hook.unmount();
      const reloaded = await mount();
      expect(reloaded.result.current.data.threads.some((thread) => thread.id === "source")).toBe(false);
      expect(reloaded.result.current.data.ledger[0].imgs).toEqual([PHOTO]);
      expect(await get(IMG(PHOTO))).toBe(PNG);
    },
  );
});
