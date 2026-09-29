/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Capture } from "@/app/Capture";
import { EMPTY, KEY } from "@/lib/model";
import * as storage from "@/lib/storage";
import { TOMBSTONE_KEY } from "@/lib/sync";
import { MANUAL_ROUTING_UNDO_KEY } from "@/lib/manualRoutingUndo";
import { PENDING_RECOVERY_KEY } from "@/lib/pendingRecovery";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

beforeEach(async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.scrollIntoView = vi.fn();
  await storage.del(PENDING_RECOVERY_KEY);
  await storage.del(MANUAL_ROUTING_UNDO_KEY);
  await storage.set(TOMBSTONE_KEY, "[]");
  await storage.set(KEY, JSON.stringify({
    ...EMPTY,
    principles: [],
    threads: [{
      id: "existing-thread",
      name: "Existing Thread",
      summary: "",
      frags: [{ id: "existing-frag", text: "Existing context", at: Date.now() }],
      updatedAt: Date.now(),
    }],
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function savePending(text: string) {
  const composer = await screen.findByPlaceholderText("Say it however it comes out.");
  fireEvent.change(composer, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Capture" }));
  await screen.findByText("Saved. Awaiting sorting or placement");
}

it("uses Unsorted disclosure styling for Faded without changing its recovery behavior", async () => {
  const saved = JSON.parse((await storage.get(KEY))!);
  saved.actions = [{ id: "faded", text: "Recover this faded action", done: false,
    at: Date.now(), faded: true, fadedAt: Date.now(), shelf: "keep", expires: null }];
  await storage.set(KEY, JSON.stringify(saved));
  render(<Capture />);
  const toggle = await screen.findByRole("button", { name: "Faded 1" });
  expect(toggle.classList.contains("unsorted-summary")).toBe(true);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("Recover this faded action")).toBeNull();
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("Recover this faded action")).toBeTruthy();
});

it("opens the exact pending capture picker from its receipt without leaving an open Thread", async () => {
  render(<Capture />);
  await screen.findByRole("button", { name: /Threads 1/i });
  fireEvent.click(screen.getByRole("button", { name: /Threads 1/i }));
  fireEvent.click(await screen.findByText("Existing Thread"));
  await screen.findByText("Existing context");

  await savePending("Place this while I remain in the Thread");
  expect(screen.getByText("Existing context")).toBeTruthy();
  const receipt = screen.getByText("Saved. Awaiting sorting or placement").closest(".landed") as HTMLElement;
  fireEvent.click(within(receipt).getByRole("button", { name: "Choose a place" }));

  const picker = screen.getByRole("dialog", { name: "Choose a place" });
  expect(within(picker).getByText("Place this while I remain in the Thread")).toBeTruthy();
  expect(screen.getByText("Existing context")).toBeTruthy();
});

async function filePending(text = "File this exact pending capture") {
  await savePending(text);
  fireEvent.click(within(screen.getByText("Saved. Awaiting sorting or placement").closest(".landed") as HTMLElement)
    .getByRole("button", { name: "Choose a place" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Choose a place" }))
    .getByRole("button", { name: "Action" }));
  await screen.findByText((_, node) => node?.textContent === "Landed in Actions.");
}

it("restores the exact manual receipt after reload and persists Undo before acknowledging it", async () => {
  const first = render(<Capture />);
  await filePending("First exact filing");
  first.unmount();
  render(<Capture />);
  const receipt = await screen.findByText((_, node) => node?.textContent === "Landed in Actions.");
  fireEvent.click(within(receipt.closest(".landed") as HTMLElement).getByRole("button", { name: "Undo" }));
  await screen.findByText("Undone — back in Unsorted.");
  const persisted = JSON.parse((await storage.get(KEY))!);
  expect(persisted.actions).toEqual([expect.objectContaining({ text: "First exact filing", unsorted: true })]);
  expect(await storage.get(MANUAL_ROUTING_UNDO_KEY)).toBe("null");
});

it("shows one truthful retryable Undo failure without losing the durable receipt", async () => {
  render(<Capture />);
  await filePending();
  const before = await storage.get(KEY);
  const inverse = await storage.get(MANUAL_ROUTING_UNDO_KEY);
  const fail = vi.spyOn(storage, "setMany").mockRejectedValue(new Error("disk full"));
  fireEvent.click(within(document.querySelector(".landed") as HTMLElement).getByRole("button", { name: "Undo" }));
  await screen.findByText("Couldn't save Undo. Nothing was changed.");
  expect(screen.queryByText((_, node) => node?.textContent === "Landed in Actions.")).toBeNull();
  expect(await storage.get(KEY)).toBe(before);
  expect(await storage.get(MANUAL_ROUTING_UNDO_KEY)).toBe(inverse);
  fail.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Retry Undo" }));
  await screen.findByText("Undone — back in Unsorted.");
});

it("ignores double Undo and never uses an older filing inverse for a newer pending capture", async () => {
  render(<Capture />);
  await filePending("Earlier filing");
  const undo = within(document.querySelector(".landed") as HTMLElement).getByRole("button", { name: "Undo" });
  fireEvent.click(undo);
  fireEvent.click(undo);
  await screen.findByText("Undone — back in Unsorted.");
  expect(screen.queryByText(/filing changed since/)).toBeNull();
  await filePending("Later filing");
  await savePending("Leave this newer capture alone");
  expect(await storage.get(MANUAL_ROUTING_UNDO_KEY)).toBe("null");
  cleanup();
  render(<Capture />);
  await screen.findByRole("button", { name: "Unsorted 2" });
  expect(screen.queryByText((_, node) => node?.textContent === "Landed in Actions.")).toBeNull();
});

it("dismisses after manual filing, names the actual destination, and offers capture-specific Undo", async () => {
  render(<Capture />);
  await savePending("File this exact pending capture");
  const receipt = screen.getByText("Saved. Awaiting sorting or placement").closest(".landed") as HTMLElement;
  fireEvent.click(within(receipt).getByRole("button", { name: "Choose a place" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Choose a place" }))
    .getByRole("button", { name: "Action" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose a place" })).toBeNull());
  const success = await screen.findByText((_, node) => node?.textContent === "Landed in Actions.");
  const successReceipt = success.closest(".landed") as HTMLElement;
  expect(screen.queryByText(/Actions, unsorted/i)).toBeNull();
  expect(screen.queryByText(/Sorting is unavailable/i)).toBeNull();
  expect(within(successReceipt).getByRole("button", { name: "Undo" })).toBeTruthy();

  fireEvent.click(within(successReceipt).getByRole("button", { name: "Undo" }));
  await screen.findByText("Undone — back in Unsorted.");
  fireEvent.click(screen.getByRole("button", { name: /^Unsorted 1$/ }));
  expect(await screen.findByText("File this exact pending capture")).toBeTruthy();
});
