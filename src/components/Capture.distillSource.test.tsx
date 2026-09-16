// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { get, set } from "@/lib/storage";
import { EMPTY, KEY } from "@/lib/model";
import { DISTILL_KEY, EMPTY_DISTILL, hydrateDistill } from "@/lib/distill";
import { Capture } from "@/app/Capture";

const recorder = vi.hoisted(() => ({ onText: (() => {}) as (text: string, raw?: string) => void }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/hooks/useRecordedDictation", () => ({
  useRecordedDictation: (onText: typeof recorder.onText) => {
    recorder.onText = onText;
    return { canDictate: true, listening: false, transcribing: false, toggleMic: vi.fn() };
  },
}));
beforeEach(async () => {
  await set(KEY, JSON.stringify({ ...EMPTY, principles: [] }));
  await set(DISTILL_KEY, JSON.stringify(EMPTY_DISTILL));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(["capture", "distill"] as const)("dictation attribution follows the draft recorded in %s, not the last surface", async (surface) => {
  render(<Capture />);
  await screen.findByText("No open loops.");
  if (surface === "distill") fireEvent.click(screen.getByRole("button", { name: "Distill instead of capture" }));
  act(() => recorder.onText("Edited recorded draft.", "um Recorded draft."));
  if (surface === "capture") {
    fireEvent.click(screen.getByRole("button", { name: "Distill instead of capture" }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", ctrlKey: true });
    await screen.findByText(/Your words are saved; ask again/);
  }
  fireEvent.click(screen.getByRole("button", { name: "← capture" }));
  if (surface === "capture") fireEvent.change(screen.getByRole("textbox"), { target: { value: "New typed capture." } });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", ctrlKey: true });
  await waitFor(async () => {
    const board = JSON.parse((await get(KEY))!);
    expect(board.ledger.at(-1)).toMatchObject(surface === "capture"
      ? { raw: "New typed capture.", source: "typed" }
      : { raw: "Edited recorded draft.", source: "dictated", transcript: "um Recorded draft." });
    if (surface === "capture") expect(board.ledger.at(-1)).not.toHaveProperty("transcript");
  });
});

it("the recorded-dictation callback keeps each original utterance in Distill, not the edited display text", async () => {
  render(<Capture />);
  await screen.findByText("No open loops.");
  fireEvent.click(screen.getByRole("button", { name: "Distill instead of capture" }));
  act(() => recorder.onText("I use ChatGPT."));
  act(() => recorder.onText("Compare it with Hermes.", "um Compare it with Hermes."));
  const input = screen.getByRole("textbox");
  expect((input as HTMLTextAreaElement).value).toBe("I use ChatGPT. Compare it with Hermes.");
  fireEvent.change(input, { target: { value: "My edited question." } });
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  await waitFor(async () => {
    const saved = hydrateDistill(await get(DISTILL_KEY));
    expect(saved.turns[0]).toMatchObject({
      role: "user", text: "My edited question.",
      transcript: "I use ChatGPT. um Compare it with Hermes.",
    });
  });
});
