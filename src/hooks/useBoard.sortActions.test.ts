// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EMPTY, KEY } from "@/lib/model";
import { set } from "@/lib/storage";
import { TOMBSTONE_KEY } from "@/lib/sync";
import { useBoard } from "./useBoard";

const note = "The hinge cracked again. Order a new hinge and email Mia by Friday.";
const step = "Ask Tomasz for a quote";
const requests: { force?: string; sortVersion?: number; raw: string }[] = [];
let answer: Response | (() => Response);

beforeEach(async () => {
  requests.length = 0;
  await set(KEY, JSON.stringify({
    ...EMPTY, principles: [],
    threads: [{ id: "studio", name: "Garden studio", summary: "", next: step, frags: [{ id: "n1", at: 1, text: note }] }],
    actions: [{ id: "open", text: "Book the dentist", done: false, at: 1, shelf: "weeks", expires: null, imgs: [] }],
  }));
  await set(TOMBSTONE_KEY, "[]");
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
    requests.push(JSON.parse(String(init?.body)));
    return typeof answer === "function" ? answer() : answer.clone();
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function mount() {
  const hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  return hook;
}

const sorted = (items: object[]) => Response.json({ sort: { version: 2, items }, via: "synthetic" });

it("takes a note's tasks through the one-call sorter as actions linked to its Thread", async () => {
  answer = sorted([
    { kind: "action", text: "Order a new hinge" },
    { kind: "action", text: "Email Mia", due: "2026-10-02" },
  ]);
  const hook = await mount();
  let ok = false;
  await act(async () => { ok = await hook.result.current.extractAction("studio", "n1"); });
  expect(ok).toBe(true);
  expect(requests).toEqual([expect.objectContaining({ raw: note, force: "action", sortVersion: 2 })]);
  const made = hook.result.current.data.actions.filter((action) => action.threadId === "studio");
  expect(made.map((action) => action.text)).toEqual(["Order a new hinge", "Email Mia"]);
  expect(made[1].due).toBeTypeOf("number");
  expect(hook.result.current.data.threads[0].frags).toHaveLength(1);
  expect(hook.result.current.notice).toContain("2 actions taken from this note");
});

it("takes the next step as one action and stops offering it", async () => {
  answer = sorted([{ kind: "action", text: "Ask Tomasz for a foundation quote" }]);
  const hook = await mount();
  await act(async () => { await hook.result.current.takeNext("studio"); });
  expect(requests[0]).toMatchObject({ raw: step, force: "action", sortVersion: 2 });
  expect(hook.result.current.data.actions[0]).toMatchObject({ text: "Ask Tomasz for a foundation quote", threadId: "studio" });
  expect(hook.result.current.data.threads[0].next).toBeNull();
});

it("adds nothing when the task is already open", async () => {
  answer = sorted([{ kind: "action", text: "Book the dentist", existingActionId: "open" }]);
  const hook = await mount();
  await act(async () => { await hook.result.current.takeNext("studio"); });
  expect(hook.result.current.data.actions.map((action) => action.id)).toEqual(["open"]);
  expect(hook.result.current.notice).toBe("Already in your actions.");
});

it("adds nothing and says so when the sorter is down", async () => {
  answer = () => Response.json({ error: "The sort didn't go through." }, { status: 503 });
  const hook = await mount();
  let ok = true;
  await act(async () => { ok = await hook.result.current.extractAction("studio", "n1"); });
  expect(ok).toBe(false);
  expect(hook.result.current.data.actions.map((action) => action.id)).toEqual(["open"]);
  expect(hook.result.current.err).toContain("Nothing was added.");
});
