/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import * as React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EMPTY, type Board } from "@/lib/model";
import type { CleanupChange } from "@/lib/cleanup";

const NOW = Date.parse("2026-09-30T12:00:00.000Z");
const DAY = 864e5;
const board = (): Board => ({
  ...EMPTY,
  threads: [
    { id: "t", name: "Kitchen", summary: "", frags: [
      { id: "f1", text: "old tap", at: NOW - 60 * DAY, imgs: ["p1"] },
      { id: "f2", text: "new tiles", at: NOW - DAY, imgs: ["p2"] },
      { id: "f3", text: "ok that", at: NOW - DAY },
      { id: "f4", text: "grout is grey", at: NOW - DAY },
    ] },
  ],
});

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("React", React);
  vi.stubGlobal("scrollTo", vi.fn());
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup(b = board()) {
  const { TidyCleanup } = await import("./TidyCleanup");
  const changes: (CleanupChange | null)[] = [];
  const onApply = vi.fn(async (change: (board: Board) => CleanupChange | null) => {
    changes.push(change(b));
    return true;
  });
  render(<TidyCleanup board={b} now={NOW} onApply={onApply} />);
  return { onApply, changes };
}

it("removes old photos only after the batch is confirmed, sparing any tapped to keep", async () => {
  const { onApply, changes } = await setup();
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  expect(screen.getByText(/2 photos\./)).toBeTruthy();
  const [newer] = screen.getAllByRole("button", { name: /tap to keep/ });
  fireEvent.click(newer);
  fireEvent.click(screen.getByRole("button", { name: "Remove 1 photo" }));
  expect(onApply).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remove" })); });
  expect(onApply).toHaveBeenCalledOnce();
  expect(changes[0]!.imgs).toEqual(["p1"]);
});

it("defaults to photos older than a month", async () => {
  await setup();
  expect(screen.getByText(/1 photo\./)).toBeTruthy();
});

it("has the model review one-liners on request and applies an approved change", async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const text = JSON.parse(init.body as string).board as string;
    const ref = text.match(/\[(L\d+)\][^\n]*ok that/)![1];
    return Response.json({ changes: [{ ref, verdict: "remove", to: null, reason: "Filler left over from dictation." }] });
  });
  vi.stubGlobal("fetch", fetch);
  const { onApply, changes } = await setup();
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Review \d+ one-liners?$/ })); });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toBe("/api/cleanup");
  expect(screen.getByText("Filler left over from dictation.")).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete" })); });
  expect(onApply).toHaveBeenCalledOnce();
  expect(changes[0]!.board.threads[0].frags.map((f) => f.id)).toEqual(["f1", "f2", "f4"]);
  // Scraps the model read and left alone, and ones just settled, are not offered again.
  expect(JSON.parse(localStorage.getItem("capture:cleanup-kept")!)).toEqual(["n:f4", "n:f3"]);
});

it("changes nothing when the model does not answer", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "No model provider is configured on the server." }, { status: 503 })));
  const { onApply } = await setup();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Review \d+ one-liners?$/ })); });
  expect(screen.getByText(/The model didn't answer, so nothing was changed\. No model provider/)).toBeTruthy();
  expect(onApply).not.toHaveBeenCalled();
  expect(localStorage.getItem("capture:cleanup-kept")).toBeNull();
});

it("shows each combination before it lands, and remembers groups kept apart", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const text = JSON.parse(init.body as string).board as string;
    const label = (s: string) => text.match(new RegExp(`\\[(N\\d+)\\][^\\n]*${s}`))![1];
    return Response.json({ groups: [
      { notes: [label("ok that"), label("grout is grey")], combined: "ok that — grout is grey", reason: "Both about the grout." },
      { notes: [label("old tap"), label("new tiles")], combined: "old tap; new tiles", reason: "Both kitchen photos." },
    ] });
  }));
  const { onApply, changes } = await setup();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Find similar notes" })); });
  expect(screen.getByText("Both about the grout.")).toBeTruthy();
  expect(screen.getByText("ok that — grout is grey")).toBeTruthy();
  const [first, second] = screen.getAllByRole("button", { name: "Keep apart" });
  expect(second).toBeTruthy();
  fireEvent.click(second);
  expect(JSON.parse(localStorage.getItem("capture:combine-kept")!)).toEqual(["f1+f2"]);
  expect(first).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Combine" })); });
  expect(onApply).toHaveBeenCalledOnce();
  const kitchen = changes[0]!.board.threads[0];
  expect(kitchen.frags.map((f) => [f.id, f.text])).toEqual([
    ["f1", "old tap"], ["f2", "new tiles"], ["f4", "ok that — grout is grey"],
  ]);
});
