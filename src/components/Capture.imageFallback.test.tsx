/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Capture } from "@/app/Capture";
import { EMPTY, IMG, KEY, type Board } from "@/lib/model";
import * as storage from "@/lib/storage";
import { TOMBSTONE_KEY } from "@/lib/sync";
import { MAX_SYNC_IMAGE_SOURCE_LENGTH } from "@/lib/imageLimits";

const { shrinkFileMock } = vi.hoisted(() => ({ shrinkFileMock: vi.fn() }));
vi.mock("@/lib/shrink", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/shrink")>()),
  shrinkFile: shrinkFileMock,
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

const ORIGINAL = "data:image/png;base64," + "A".repeat(MAX_SYNC_IMAGE_SOURCE_LENGTH);

beforeEach(async () => {
  for (const key of await storage.keys()) await storage.del(key);
  await storage.set(KEY, JSON.stringify({ ...EMPTY, principles: [] }));
  await storage.set(TOMBSTONE_KEY, "[]");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  Element.prototype.scrollIntoView = vi.fn();
  shrinkFileMock.mockResolvedValue(ORIGINAL);
});

afterEach(() => {
  cleanup();
  shrinkFileMock.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps and captures the selected original when re-encoding cannot produce Cloud-safe bytes", async () => {
  const view = render(<Capture />);
  await screen.findByPlaceholderText("Say it however it comes out.");
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')!;
  const file = new File([Uint8Array.from([1, 2, 3])], "selected.png", { type: "image/png" });

  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(view.container.querySelector<HTMLImageElement>(".thumb img")?.src)
    .toBe(ORIGINAL));
  expect(screen.getByRole("button", { name: "Capture" }).hasAttribute("disabled")).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "Capture" }));
  await screen.findByText("Saved. Awaiting sorting or placement", {}, { timeout: 15_000 });

  const board = JSON.parse((await storage.get(KEY))!) as Board;
  const pending = board.actions.find((action) => action.unsorted)!;
  expect(pending.imgs).toHaveLength(1);
  expect(board.ledger.find((entry) => entry.kind === "pending")?.imgs).toEqual(pending.imgs);
  expect(await storage.get(IMG(pending.imgs![0]))).toBe(ORIGINAL);
  expect(shrinkFileMock).toHaveBeenCalledWith(file);
}, 20_000);
