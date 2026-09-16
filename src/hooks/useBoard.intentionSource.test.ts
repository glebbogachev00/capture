// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { get, set } from "@/lib/storage";
import { EMPTY, KEY } from "@/lib/model";
import * as model from "@/lib/model";
import { undoRule } from "@/lib/refiled";
import { useBoard } from "./useBoard";

beforeEach(async () => {
  await set(KEY, JSON.stringify({ ...EMPTY, principles: [] }));
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (url === "/api/intention") return Response.json({ expandedIntention: "I choose thoughtfully." });
    if (url === "/api/sort") return Response.json({ kind: "intention", clean: "I choose thoughtfully." });
    return new Response(null, { status: 503 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const original = "I want to choose my training schedule thoughtfully.";
const reviewed = "Compare morning and evening training schedules.";
const recognizer = "  um I want to choose my training schedule thoughtfully.\n";

it.each([undefined, "intention"] as const)("correcting an edited dictated draft (%s) preserves origin, learning and Undo", async (force) => {
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (url === "/api/intention") return Response.json({ expandedIntention: "I choose thoughtfully." });
    if (url === "/api/sort") {
      const body = JSON.parse(init!.body as string);
      return Response.json(body.force === "thread"
        ? { kind: "thread", clean: body.raw, threadName: "Training schedule", actions: [] }
        : { kind: "intention", clean: body.raw });
    }
    return new Response(null, { status: 503 });
  });
  const hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  const ids = vi.spyOn(model, "uid");
  act(() => { hook.result.current.setText(original); hook.result.current.setTranscript(recognizer); });
  await act(async () => { await hook.result.current.submit(true, force); });
  const captureId = ids.mock.results[0].value;
  expect(hook.result.current.data.ledger).toHaveLength(0);
  expect(hook.result.current.text).toBe("");
  expect(hook.result.current.captureDictated).toBe(false);
  act(() => hook.result.current.setDraft({ ...hook.result.current.draft!, rawInput: reviewed }));
  await act(async () => { await hook.result.current.draftToThread(); });
  expect(hook.result.current.draft).toBeNull();
  expect(hook.result.current.data.threads[0].frags[0].text).toBe(reviewed);
  const evidence = { raw: original, clean: reviewed, source: "dictated", transcript: recognizer, captureId };
  expect(hook.result.current.data.ledger.at(-1)).toMatchObject(evidence);
  const lesson = undoRule(reviewed, "intention", "thread");
  expect(hook.result.current.data.corrections).toEqual(expect.arrayContaining([expect.objectContaining({ rule: lesson })]));
  expect(JSON.parse((await get(KEY))!).ledger.at(-1)).toMatchObject(evidence);
  const sortCalls = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/sort");
  expect(JSON.parse(sortCalls.at(-1)![1]!.body as string)).toMatchObject({ raw: reviewed, force: "thread" });
  for (const [url, init] of vi.mocked(fetch).mock.calls) {
    if (url === "/api/sort" || url === "/api/intention") {
      expect(init!.body as string).not.toContain("transcript");
      expect(init!.body as string).not.toContain("um I want");
    }
  }
  expect(hook.result.current.canUndo).toBe(true);
  await act(async () => { await hook.result.current.undo(); });
  expect(hook.result.current.text).toBe(reviewed);
  expect(hook.result.current.data.threads).toHaveLength(0);
  expect(hook.result.current.data.ledger.at(-1)).toMatchObject({ ...evidence, undone: true });
  expect(hook.result.current.data.corrections).toEqual(expect.arrayContaining([expect.objectContaining({ rule: lesson })]));
});

it("a failed thread correction parks edited words as an action without losing the draft's evidence", async () => {
  const hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  const ids = vi.spyOn(model, "uid");
  act(() => { hook.result.current.setText(original); hook.result.current.setTranscript(recognizer); });
  await act(async () => { await hook.result.current.submit(true); });
  const captureId = ids.mock.results[0].value;
  act(() => hook.result.current.setDraft({ ...hook.result.current.draft!, rawInput: reviewed }));
  vi.mocked(fetch).mockImplementation(async () => new Response(null, { status: 503 }));
  await act(async () => { await hook.result.current.draftToThread(); });
  expect(hook.result.current.data.actions[0]).toMatchObject({ text: reviewed, unsorted: true });
  const evidence = { raw: original, clean: reviewed, source: "dictated", transcript: recognizer, captureId };
  expect(JSON.parse((await get(KEY))!).ledger.at(-1)).toMatchObject(evidence);
  await act(async () => { await hook.result.current.undo(); });
  expect(hook.result.current.text).toBe(reviewed);
  expect(hook.result.current.data.actions).toHaveLength(0);
  expect(hook.result.current.data.ledger.at(-1)).toMatchObject({ ...evidence, undone: true });
});

it.each([undefined, "intention"] as const)("discarding an edited dictated draft (%s) preserves recoverable evidence", async (force) => {
  const hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  const ids = vi.spyOn(model, "uid");
  act(() => { hook.result.current.setText(original); hook.result.current.setTranscript(recognizer); });
  await act(async () => { await hook.result.current.submit(true, force); });
  const captureId = ids.mock.results[0].value;
  act(() => hook.result.current.setDraft({ ...hook.result.current.draft!, rawInput: reviewed }));
  await act(async () => { await hook.result.current.discardDraft(); });
  expect(hook.result.current.draft).toBeNull();
  expect(hook.result.current.data.actions).toHaveLength(0);
  expect(hook.result.current.data.threads).toHaveLength(0);
  expect(hook.result.current.data.intentions).toHaveLength(0);
  expect(JSON.parse((await get(KEY))!).ledger.at(-1)).toMatchObject({
    raw: original, clean: reviewed, source: "dictated", transcript: recognizer, captureId, undone: true,
  });
  act(() => hook.result.current.setText("An unrelated typed intention."));
  await act(async () => { await hook.result.current.submit(); });
  await act(async () => { await hook.result.current.saveDraft(); });
  const next = hook.result.current.data.ledger.find(entry => entry.raw === "An unrelated typed intention.");
  expect(next).toMatchObject({ source: "typed" });
  expect(next).not.toHaveProperty("transcript");
});

it.each([undefined, "intention"] as const)("capture intention (%s) transfers its source to the pending draft, not the next capture", async (force) => {
  const hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => {
    hook.result.current.setText("My edited intention.");
    hook.result.current.setTranscript(" um My original intention.\n");
  });
  await act(async () => { await hook.result.current.submit(true, force); });
  await act(async () => { await hook.result.current.saveDraft(); });
  expect(hook.result.current.data.ledger.at(-1)).toMatchObject({
    raw: "My edited intention.", source: "dictated", transcript: " um My original intention.\n",
  });
  expect(hook.result.current.captureDictated).toBe(false);
  act(() => hook.result.current.setText("New typed intention."));
  await act(async () => { await hook.result.current.submit(false, force); });
  await act(async () => { await hook.result.current.saveDraft(); });
  const next = hook.result.current.data.ledger.find(entry => entry.raw === "New typed intention.");
  expect(next).toMatchObject({ raw: "New typed intention.", source: "typed" });
  expect(next).not.toHaveProperty("transcript");
});
