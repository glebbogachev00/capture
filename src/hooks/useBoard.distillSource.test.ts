// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { get, set } from "@/lib/storage";
import { EMPTY, KEY, hydrate } from "@/lib/model";
import { buildBackup, restoreBackup } from "@/lib/backup";
import { DISTILL_KEY, EMPTY_DISTILL, hydrateDistill } from "@/lib/distill";
import { useBoard } from "./useBoard";

const edited = "Compare ChatGPT with Hermes.";
const transcript = "  um Compare ChatGPT with Hermes.\n";
beforeEach(async () => {
  await set(KEY, JSON.stringify({ ...EMPTY, principles: [] }));
  await set(DISTILL_KEY, JSON.stringify(EMPTY_DISTILL));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("moves dictated capture evidence into a saved Distill turn even when the reply fails", async () => {
  const hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => {
    hook.result.current.setText(edited);
    hook.result.current.setTranscript(transcript);
  });
  act(() => hook.result.current.openDistill());
  expect(hook.result.current.text).toBe("");
  expect(hook.result.current.distillInput).toBe(edited);
  await act(async () => { await hook.result.current.sendDistill(); });
  expect(hook.result.current.distillSession.turns).toEqual([
    { role: "user", text: edited, transcript, at: expect.any(Number) },
  ]);
  const saved = hydrateDistill(await get(DISTILL_KEY));
  expect(saved).toEqual(hook.result.current.distillSession);
  expect(JSON.parse(JSON.stringify(saved)).turns[0].transcript).toBe(transcript);
  const request = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/distill")!;
  expect(JSON.parse(request[1]!.body as string)).toEqual({
    op: "chat", turns: [{ role: "user", text: edited }],
  });
  hook.unmount();
  const reloaded = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(reloaded.result.current.loaded).toBe(true));
  expect(reloaded.result.current.distillSession).toEqual(saved);
  act(() => reloaded.result.current.setDistillInput("Unrelated typed turn."));
  await act(async () => { await reloaded.result.current.sendDistill(); });
  expect(reloaded.result.current.distillSession.turns.at(-1)).not.toHaveProperty("transcript");
});


it("returns source with the unsent draft when closing Distill", async () => {
  const hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => { hook.result.current.setText(edited); hook.result.current.setTranscript(transcript); });
  act(() => hook.result.current.openDistill());
  act(() => hook.result.current.closeDistill());
  expect(hook.result.current.text).toBe(edited);
  expect(hook.result.current.distillInput).toBe("");
  await act(async () => { await hook.result.current.submit(true); });
  expect(hook.result.current.data.ledger.at(-1)?.transcript).toBe(transcript);
});

it.each(["resetDistill", "discardDistill"] as const)("%s clears only the Distill draft source", async (reset) => {
  const hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => {
    hook.result.current.setText("Capture draft."); hook.result.current.setTranscript("Capture original.");
    hook.result.current.setDistillInput(edited); hook.result.current.setDistillTranscript(transcript);
  });
  act(() => hook.result.current.openDistill());
  await act(async () => { await hook.result.current[reset](); });
  expect(hook.result.current.distillInput).toBe("");
  act(() => hook.result.current.setDistillInput("A new typed turn."));
  await act(async () => { await hook.result.current.sendDistill(); });
  expect(hook.result.current.distillSession.turns[0]).not.toHaveProperty("transcript");
  expect(hook.result.current.text).toBe("Capture draft.");
  await act(async () => { await hook.result.current.submit(true); });
  expect(hook.result.current.data.ledger.at(-1)?.transcript).toBe("Capture original.");
});

it.each(["action", "thread", "intention"] as const)("settled %s keeps voice evidence in the exported ledger after the session resets", async (kind) => {
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    const body = JSON.parse((init?.body as string) || "{}");
    if (url === "/api/distill" && body.op === "settle") return Response.json({ kind, title: "Comparison", clean: edited });
    if (url === "/api/intention") return Response.json({ expandedIntention: "Compare tools thoughtfully." });
    return new Response(null, { status: 503 });
  });
  const hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => { hook.result.current.setDistillInput(edited); hook.result.current.setDistillTranscript(transcript); });
  await act(async () => { await hook.result.current.sendDistill(); });
  await act(async () => { await hook.result.current.settleDistill(); });
  await act(async () => { await hook.result.current.saveSettled(edited, kind === "action" ? [edited] : [], "keep"); });
  if (kind === "intention") await act(async () => { await hook.result.current.saveDraft(); });
  expect(hook.result.current.distillSession.turns).toHaveLength(0);
  const board = hydrate(JSON.parse((await get(KEY))!));
  expect(board.ledger.at(-1)).toMatchObject({ raw: edited, transcript, source: "distill" });
  const exported = JSON.parse(JSON.stringify(buildBackup(board)));
  const restored = restoreBackup(exported, { ...EMPTY, principles: [] });
  expect(restored.board.ledger.at(-1)).toMatchObject({ raw: edited, transcript, source: "distill" });
  for (const [url, init] of vi.mocked(fetch).mock.calls) {
    if (url !== "/api/distill") continue;
    const body = JSON.parse(init!.body as string);
    expect(body.turns).toEqual([{ role: "user", text: edited }]);
  }
});

it.each([false, true])("keeps both populated draft buffers and their sources independent (reply succeeds: %s)", async (success) => {
  if (success) vi.mocked(fetch).mockImplementation(async (url) => url === "/api/distill"
    ? new Response("A useful reply.") : new Response(null, { status: 503 }));
  const hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => {
    hook.result.current.setText("Capture draft."); hook.result.current.setTranscript("Capture original.");
    hook.result.current.setDistillInput(edited); hook.result.current.setDistillTranscript(transcript);
  });
  act(() => hook.result.current.openDistill());
  act(() => hook.result.current.closeDistill());
  expect(hook.result.current.text).toBe("Capture draft.");
  expect(hook.result.current.distillInput).toBe(edited);
  act(() => hook.result.current.openDistill());
  await act(async () => { await hook.result.current.sendDistill(); });
  expect(hook.result.current.distillSession.turns[0]?.transcript).toBe(transcript);
  expect(hook.result.current.distillSession.turns).toHaveLength(success ? 2 : 1);
  expect(hydrateDistill(await get(DISTILL_KEY))).toEqual(hook.result.current.distillSession);
  act(() => hook.result.current.setDistillInput("Next typed turn."));
  await act(async () => { await hook.result.current.sendDistill(); });
  expect(hook.result.current.distillSession.turns.filter(t => t.role === "user").at(-1)).not.toHaveProperty("transcript");
  await act(async () => { await hook.result.current.submit(true); });
  expect(hook.result.current.data.ledger.at(-1)?.transcript).toBe("Capture original.");
});

it("an explicit Talk turn does not consume the unsent dictated draft", async () => {
  const hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => { hook.result.current.setText(edited); hook.result.current.setTranscript(transcript); });
  act(() => hook.result.current.openDistill());
  await act(async () => { await hook.result.current.sendDistill("A separate Talk turn."); });
  expect(hook.result.current.distillSession.turns[0]).not.toHaveProperty("transcript");
  expect(hook.result.current.distillInput).toBe(edited);
  await act(async () => { await hook.result.current.sendDistill(); });
  expect(hook.result.current.distillSession.turns.at(-1)?.transcript).toBe(transcript);
});
