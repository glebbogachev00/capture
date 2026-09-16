// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { get, set } from "@/lib/storage";
import { EMPTY, KEY } from "@/lib/model";
import { useBoard } from "./useBoard";

const text = "I use ChatGPT. Compare it with Hermes.";
const transcript = "I use ChatGPT. um Compare it with Hermes.";
beforeEach(async () => {
  await set(KEY, JSON.stringify({ ...EMPTY, principles: [] }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("a failed dictated capture retains every utterance and clears evidence before the next capture", async () => {
  const hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => {
    hook.result.current.setText(text);
    hook.result.current.setTranscript(transcript);
  });
  await act(async () => { await hook.result.current.submit(true); });
  expect(hook.result.current.data.actions[0].text).toBe(text);
  expect(hook.result.current.data.actions[0].unsorted).toBe(true);
  expect(hook.result.current.data.ledger.at(-1)?.transcript).toBe(transcript);

  const persisted = JSON.parse((await get(KEY))!);
  expect(persisted.ledger.at(-1).transcript).toBe(transcript);
  act(() => hook.result.current.setText("An unrelated typed capture."));
  await act(async () => { await hook.result.current.submit(false); });
  const next = hook.result.current.data.ledger.find(entry => entry.raw === "An unrelated typed capture.");
  expect(next).toBeDefined();
  expect(next?.transcript).toBeUndefined();
});

it("Undo after a failed overridden capture restores its own words", async () => {
  const hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  await act(async () => { await hook.result.current.submit(false, "thread", text); });
  await act(async () => { await hook.result.current.undo(); });
  expect(hook.result.current.text).toBe(text);
  expect(hook.result.current.data.actions).toHaveLength(0);
  expect(hook.result.current.data.ledger.some(entry => entry.raw === text)).toBe(true);
});
