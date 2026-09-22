// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { set } from "@/lib/storage";
import { EMPTY, KEY } from "@/lib/model";
import { applySorted, type SortResult } from "@/lib/boardOps";
import { recordSortedCapture } from "@/lib/settle";
import { shareAction } from "@/lib/share";
import { applyActionFold } from "@/lib/actionOps";
import { useBoard } from "./useBoard";

const at = 1_756_000_000_000;
const thinking = "I am debating annual pricing versus monthly pricing.";
const mom = "Call mom this weekend";
const stripe = "Fix the Stripe webhook retry bug";
const raw = `${thinking} ${stripe}. ${mom}.`;
const calls: { url: string; body: { raw?: string; rawInput?: string } }[] = [];
const sorted: SortResult = { kind: "both", title: "Pricing and errands", clean: raw,
  primaryText: thinking, primaryActions: [], actions: [stripe, mom], threadId: "pricing", also: [] };

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const body = JSON.parse(init?.body || "{}");
    calls.push({ url: String(url), body });
    if (url === "/api/sort") return Response.json({ kind: "action", title: body.raw, clean: body.raw, actions: [body.raw], shelfLife: "keep" });
    if (url === "/api/summarize") return Response.json({ summary: "Synthetic summary" });
    return new Response(null, { status: 503 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function mount(out = sorted) {
  const applied = applySorted(out, [], at, { ...EMPTY, principles: [], threads: [
    { id: "pricing", name: "Annual pricing", summary: "", frags: [] },
    { id: "family", name: "Family", summary: "", frags: [] },
  ] });
  const recorded = recordSortedCapture(applied.next, {
    raw, payload: raw, clean: out.clean, primaryText: out.primaryText, kind: out.kind,
    at, dictated: false, imgIds: [], captureId: "synthetic",
    primary: { targetId: applied.targetId || "", fragId: applied.source?.fragId }, also: [],
  }, () => "synthetic-ledger").board;
  await set(KEY, JSON.stringify(recorded));
  const hook = renderHook(() => useBoard(at + 60_000));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  return hook;
}
it.each(["fold", "new thread", "resort", "share", "intention"])("sort→%s uses only the selected errand, retaining its sibling and original Record", async (operation) => {
  const { result } = await mount();
  const a = result.current.data.actions.find(a => a.text === mom)!;
  const record = JSON.stringify(result.current.data.ledger);
  if (operation === "fold") {
    const folded = applyActionFold(result.current.data, a.id, "family", at + 60_000, () => "fold-frag")!;
    expect(folded.board.threads.find(t => t.id === "family")!.frags.map(f => f.text)).toEqual([mom]);
    expect(folded.board.actions.some(x => x.id === a.id)).toBe(false);
    expect(JSON.stringify(folded.board.ledger)).toBe(record);
  } else if (operation === "new thread") {
    await act(async () => { await result.current.moveToThread(a); });
    expect(result.current.data.threads[0].frags[0].text).toBe(mom);
  } else if (operation === "resort") {
    await act(async () => { await result.current.resort(a); });
    expect(calls.find(c => c.url === "/api/sort")!.body.raw).toBe(mom);
    expect(result.current.data.actions.map(a => a.text).sort()).toEqual([mom, stripe].sort());
    expect(result.current.data.ledger.some(entry =>
      entry.kind === "action" && entry.clean === mom
    )).toBe(true);
  } else if (operation === "share") {
    expect(shareAction(a).text).toBe(mom);
  } else {
    // Same boundary Capture.tsx uses; expansion failure must retain the action.
    await act(async () => { await result.current.makeIntention(a.src || a.text, a.id); });
    expect(calls.find(c => c.url === "/api/intention")!.body.rawInput).toBe(mom);
    expect(result.current.data.actions.some(x => x.id === a.id)).toBe(true);
  }
  expect(result.current.data.actions.some(a => a.text === stripe)).toBe(true);
  if (operation !== "resort") expect(JSON.stringify(result.current.data.ledger)).toBe(record);
  expect(result.current.data.ledger.find(entry => entry.raw === raw)).toMatchObject({
    raw,
    clean: raw,
  });
});
it("a multi-action-only capture does not fold its sibling with the selected action", async () => {
  const { result } = await mount({ ...sorted, kind: "action", primaryText: null });
  const a = result.current.data.actions.find(a => a.text === mom)!;
  const folded = applyActionFold(result.current.data, a.id, "family", at + 60_000, () => "fold-frag")!;
  expect(folded.board.threads.find(t => t.id === "family")!.frags[0].text).toBe(mom);
});
