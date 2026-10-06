// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as storage from "@/lib/storage";
import { CORRUPT, EMPTY, IMG, KEY } from "@/lib/model";
import type { PlannedRoutingPlan } from "@/lib/plannedRouting";
import { snapshotManualPending } from "@/lib/manualRoutingSettlement";
import { MANUAL_ROUTING_UNDO_KEY } from "@/lib/manualRoutingUndo";
import { deriveCorrectionExamples } from "@/lib/correctionExamples";
import { TOMBSTONE_KEY } from "@/lib/sync";
import {
  PENDING_RECOVERY_BACKOFF_MS,
  PENDING_RECOVERY_KEY,
  parsePendingRecoveryRecords,
} from "@/lib/pendingRecovery";
import { useBoard } from "./useBoard";
import { stubSortFetch } from "../../test/simpleSortFetch";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const responseFor = (captureId: string, raw: string) => {
  const routingPlan: PlannedRoutingPlan = {
    items: [{
      id: "action-one",
      source: raw,
      kind: "action",
      action: raw,
      due: null,
      ownerId: null,
      destinations: [],
      duplicateActionId: null,
      unresolved: false,
      ambiguity: null,
    }],
    newThreads: [],
  };
  return Response.json({
    planned: true,
    captureId,
    routingPlan,
    recovery: {
      clean: raw,
      kind: "action",
      title: "Captured action",
      actions: [raw],
      primaryActions: [],
      shelfLife: "keep",
      due: null,
      threadId: null,
      threadName: null,
      primaryText: null,
      also: [],
    },
    via: "synthetic-planner",
  });
};

const sortedResponse = (raw: string, kind: "action" | "intention" = "action") =>
  Response.json({
    clean: raw,
    kind,
    title: raw,
    actions: kind === "action" ? [raw] : [],
    shelfLife: "keep",
    due: null,
    threadId: null,
    threadName: null,
    primaryText: null,
    also: [],
  });

beforeEach(async () => {
  await storage.del(CORRUPT);
  await storage.del(PENDING_RECOVERY_KEY);
  await storage.del(MANUAL_ROUTING_UNDO_KEY);
  await storage.set(KEY, JSON.stringify({
    ...EMPTY,
    principles: [],
    threads: [{ id: "destination", name: "Destination", summary: "", frags: [] }],
  }));
  await storage.set(TOMBSTONE_KEY, "[]");
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

describe("local-first planned capture", () => {
  it.each(["automatic", "manual"])("shows the quota reset and keeps the original (%s)", async (mode) => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(mode === "automatic");
    let calls = 0;
    stubSortFetch(vi.fn(async (url: unknown) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      calls++;
      return Response.json({ error: "quota exceeded" }, { status: 429,
        headers: { Date: "Wed, 30 Sep 2026 09:00:00 GMT", "Retry-After": "3600" } });
    }));
    const hook = await mount();
    const raw = "Keep this complete thought for Capture.";
    act(() => hook.result.current.setText(raw));
    await act(async () => { await hook.result.current.submit(); });
    if (mode === "manual") {
      online.mockReturnValue(true);
      await act(async () => { await hook.result.current.resort(hook.result.current.data.actions.find(a => a.unsorted)!); });
    }
    await waitFor(() => expect(hook.result.current.err).toContain("Your AI allowance resets"));
    expect(hook.result.current.err).toContain("Saved in Unsorted.");
    expect(hook.result.current.err).not.toContain("untouched");
    expect(calls).toBe(1);
    expect(hook.result.current.data.actions.filter(a => a.unsorted)).toHaveLength(1);
    const saved = JSON.parse((await storage.get(KEY))!);
    expect(saved.ledger.some((entry: { raw: string; kind: string }) => entry.raw === raw && entry.kind === "pending")).toBe(true);
  });
  it.each(["complete", "edited", "deleted", "failed"])("fills mixed-capture Intention details without changing routing (%s)", async (outcome) => {
    const thought = "For Ovid, the tower needs rain. ";
    const intention = "My intention: I allow myself to rest.";
    const raw = thought + intention;
    const expansion = deferred<Response>();
    const requested: string[] = [];
    stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) === "/api/intention") {
        requested.push(JSON.parse(String(init?.body)).rawInput);
        return expansion.promise;
      }
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      const base = { action: null, due: null, ownerId: null, duplicateActionId: null, unresolved: false, ambiguity: null };
      return Response.json({
        planned: true, captureId: JSON.parse(String(init?.body)).captureId,
        routingPlan: { items: [
          { ...base, id: "thought", source: thought, kind: "developing_thought", destinations: [{ type: "existing", threadId: "destination" }] },
          { ...base, id: "intention", source: intention, kind: "intention", destinations: [] },
        ], newThreads: [] },
        recovery: { clean: raw, kind: "thread", title: "Notes", actions: [], primaryActions: [], shelfLife: "keep", due: null, threadId: "destination", threadName: null },
      });
    }));
    const hook = await mount();
    act(() => hook.result.current.setText(raw));
    await act(async () => { await hook.result.current.submit(); });
    await waitFor(() => expect(hook.result.current.data.intentions).toHaveLength(1));
    await waitFor(() => expect(requested).toEqual([intention]));
    const saved = hook.result.current.data.intentions[0];
    if (outcome === "edited") await act(async () => { await hook.result.current.updateIntention({ ...saved, expandedIntention: "My own wording" }); });
    if (outcome === "deleted") await act(async () => { await hook.result.current.deleteIntention(saved.id); });
    await act(async () => {
      expansion.resolve(outcome === "failed" ? new Response(null, { status: 503 }) : Response.json({
        expandedIntention: "A model rewrite that must not replace the saved wording",
        recommendedActions: ["I take a walk.", "I play a game.", "I leave work alone."],
        counterIntentions: ["I turn rest into another target."],
      }));
    });
    if (outcome === "complete") {
      await waitFor(() => expect(hook.result.current.data.intentions[0].recommendedActions).toHaveLength(3));
      expect(hook.result.current.data.intentions[0]).toMatchObject({ rawInput: intention, expandedIntention: intention, counterIntentions: ["I turn rest into another target."] });
      expect(JSON.parse((await storage.get(KEY))!).intentions[0].recommendedActions).toHaveLength(3);
    } else if (outcome === "deleted") expect(hook.result.current.data.intentions).toEqual([]);
    else expect(hook.result.current.data.intentions[0]).toMatchObject({ expandedIntention: outcome === "edited" ? "My own wording" : intention, recommendedActions: [], counterIntentions: [] });
    expect(hook.result.current.data.threads[0].frags[0].text).toBe(thought);
    expect(hook.result.current.data.actions).toEqual([]);
    expect(hook.result.current.data.ledger.some(entry => entry.raw === raw)).toBe(true);
  });
  it("automatically files a planned 502 through one legacy recovery without a click", async () => {
    const raw = "Call the dentist";
    const requests: Array<{ captureId?: string }> = [];
    stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      const request = JSON.parse(String(init?.body));
      requests.push(request);
      return request.captureId
        ? Response.json({ error: "SOURCE_NOT_ACCOUNTED" }, { status: 502 })
        : sortedResponse(raw);
    }));
    const hook = await mount();
    act(() => hook.result.current.setText(raw));
    await act(async () => { await hook.result.current.submit(); });
    await waitFor(() => expect(hook.result.current.unsorted).toHaveLength(0));
    expect(requests).toHaveLength(2);
    expect(requests[0].captureId).toBeTruthy();
    expect(requests[1].captureId).toBeUndefined();
    expect(hook.result.current.data.actions).toEqual([expect.objectContaining({ text: raw })]);
    expect(JSON.parse((await storage.get(KEY))!).actions).toEqual([expect.objectContaining({ text: raw })]);
  });

  it.each([54_000, 55_000])("bounds automatic legacy recovery by the original 55 second deadline after %sms", async (elapsed) => {
    const first = deferred<Response>();
    const signals: AbortSignal[] = [];
    let requestedAt = 0;
    stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      signals.push(init!.signal!);
      if (signals.length === 1) { requestedAt = Date.now(); return first.promise; }
      return new Promise<Response>(() => {});
    }));
    const hook = await mount();
    act(() => hook.result.current.setText("Bound the total deadline"));
    await act(async () => { await hook.result.current.submit(); });
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(hook.result.current.autoSortingIds).toEqual([hook.result.current.unsorted[0].id]);
    expect(hook.result.current.landed).toBe("Saved. Sorting…");
    vi.useFakeTimers();
    try {
      vi.setSystemTime(requestedAt + elapsed);
      await act(async () => { first.resolve(new Response(null, { status: 502 })); });
      expect(signals).toHaveLength(elapsed < 55_000 ? 2 : 1);
      if (elapsed < 55_000) {
        expect(hook.result.current.autoSortingIds).toEqual([hook.result.current.unsorted[0].id]);
      }
      await act(async () => { await vi.advanceTimersByTimeAsync(1_001); });
      if (elapsed < 55_000) expect(signals[1].aborted).toBe(true);
      expect(hook.result.current.autoSortingIds).toEqual([]);
      expect(hook.result.current.unsorted).toHaveLength(1);
      expect(signals).toHaveLength(elapsed < 55_000 ? 2 : 1);
    } finally { vi.useRealTimers(); }
  });

  it("retains one exact commanded pending capture after both automatic calls fail", async () => {
    const first = deferred<Response>();
    const requests: Array<{ force?: string }> = [];
    stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      requests.push(JSON.parse(String(init?.body)));
      return requests.length === 1 ? first.promise : new Response(null, { status: 502 });
    }));
    const hook = await mount();
    const raw = "  /action Keep Unicode — exactly. \n";
    act(() => hook.result.current.setText(raw));
    await act(async () => { await hook.result.current.submit(); });
    await waitFor(() => expect(requests).toHaveLength(1));
    const before = hook.result.current.unsorted[0];
    await act(async () => { first.resolve(new Response(null, { status: 502 })); });
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(hook.result.current.unsorted).toEqual([before]);
    expect(requests.map((request) => request.force)).toEqual(["action", "action"]);
    expect(hook.result.current.data.ledger.filter((entry) => !entry.undone))
      .toEqual([expect.objectContaining({ kind: "pending", raw })]);
    expect(hook.result.current.err).toBe("");
    expect(hook.result.current.landed).toBe("Saved. Awaiting sorting or placement");
  });

  it.each(["manual", "edit", "offline", "unmount"] as const)(
    "suppresses automatic legacy recovery after %s while planned request fails", async (mode) => {
      let online = true;
      vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
      const first = deferred<Response>();
      const network = vi.fn(async (url: unknown) => String(url) === "/api/sort"
        ? first.promise : new Response(null, { status: 503 }));
      stubSortFetch(network);
      const hook = await mount();
      act(() => hook.result.current.setText("Manual placement wins"));
      await act(async () => { await hook.result.current.submit(); });
      await waitFor(() => expect(network.mock.calls.filter(([url]) => url === "/api/sort")).toHaveLength(1));
      await act(async () => {
        if (mode === "manual") await hook.result.current.manualSort(hook.result.current.unsorted[0], { kind: "action" });
        if (mode === "edit") await hook.result.current.editUnsorted(hook.result.current.unsorted[0].id, "Edited source wins");
        if (mode === "offline") online = false;
        if (mode === "unmount") hook.unmount();
        first.resolve(new Response(null, { status: 502 }));
      });
      expect(network.mock.calls.filter(([url]) => url === "/api/sort")).toHaveLength(1);
    },
  );

  it.each(["action-thread", "threads", "action-intention", "unresolved"] as const)(
    "reports only actual settled destinations in the %s receipt",
    async (kind) => {
      const raw = "Call the dentist. My intention: I protect quiet mornings.";
      const delayed = deferred<Response>();
      let captureId = "";
      stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
        if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
        captureId = JSON.parse(String(init?.body)).captureId;
        return delayed.promise;
      }));
      if (kind === "threads") {
        const board = JSON.parse((await storage.get(KEY))!);
        board.threads.push({ id: "second-thread", name: "Quiet · mornings", summary: "", frags: [] });
        await storage.set(KEY, JSON.stringify(board));
      }
      const hook = await mount();
      act(() => hook.result.current.setText(raw));
      await act(async () => { await hook.result.current.submit(); });
      await waitFor(() => expect(captureId).not.toBe(""));
      const originalPendingId = hook.result.current.unsorted[0].id;
      const response = await responseFor(captureId, raw).json();
      const base = response.routingPlan.items[0];
      response.routingPlan.items = kind === "unresolved"
        ? [{ ...base, unresolved: true, ambiguity: "Unclear destination" }]
        : [
            { ...base, source: "Call the dentist. ", action: "Call the dentist" },
            { ...base, id: "second", source: "My intention: I protect quiet mornings.", kind: kind === "action-intention" ? "intention" : "developing_thought", action: null,
              destinations: kind === "action-intention" ? [] : [{ type: "existing", threadId: "destination" }] },
          ];
      if (kind === "threads") {
        response.routingPlan.items[0] = { ...response.routingPlan.items[0], kind: "developing_thought", action: null, destinations: [{ type: "existing", threadId: "second-thread" }] };
      }
      await act(async () => { delayed.resolve(Response.json(response)); });
      if (kind === "unresolved") {
        /* Nothing understood: the capture itself stays pending for placement. */
        await waitFor(() => expect(hook.result.current.landed).toBe("Saved. Awaiting sorting or placement"));
        expect(hook.result.current.unsorted.map((action) => action.id)).toEqual([originalPendingId]);
        expect(hook.result.current.pendingReceiptId).toBe(originalPendingId);
        expect(hook.result.current.data.threads[0].frags).toHaveLength(0);
      } else {
        await waitFor(() => expect(hook.result.current.unsorted).toHaveLength(0));
        expect(hook.result.current.landedLines).toEqual(kind === "action-thread"
          ? ["Actions", "Thread: Destination"]
          : kind === "action-intention" ? ["Actions", "Intentions"]
          : ["Thread: Quiet · mornings", "Thread: Destination"]);
        expect(hook.result.current.tab).toBe(kind === "threads" ? "threads" : "actions");
      }
    },
  );
  it.each(["action", "thread"] as const)(
    "lets a later manual choice override delayed /%s command recovery after reload",
    async (force) => {
      let online = false;
      vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
      const delayed = deferred<Response>();
      let captureId = "";
      stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
        if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
        captureId = JSON.parse(String(init?.body)).captureId;
        return delayed.promise;
      }));
      const payload = "A later manual choice wins";
      const hook = await mount();
      act(() => hook.result.current.setText(`/${force} ${payload}`));
      await act(async () => { await hook.result.current.submit(); });
      hook.unmount();
      online = true;
      const reopened = await mount();
      await waitFor(() => expect(captureId).not.toBe(""));
      const destination = force === "action"
        ? { kind: "thread" as const, threadId: "destination" }
        : { kind: "action" as const };
      await act(async () => {
        expect(await reopened.result.current.manualSort(reopened.result.current.unsorted[0], destination)).toBe(true);
      });
      const response = await responseFor(captureId, payload).json();
      if (force === "thread") response.routingPlan.items[0] = {
        ...response.routingPlan.items[0], kind: "developing_thought", action: null,
        destinations: [{ type: "existing", threadId: "destination" }],
      };
      await act(async () => { delayed.resolve(Response.json(response)); });
      expect(reopened.result.current.unsorted).toHaveLength(0);
      expect(reopened.result.current.data.ledger.filter((entry) => !entry.undone))
        .toEqual([expect.objectContaining({ kind: destination.kind, settledBy: "manual" })]);
    },
  );


  it.each([
    ["action", false], ["thread", false], ["intention", false],
    ["action", true], ["thread", true], ["intention", true],
  ] as const)("settles a command-compatible /%s result (offline reload: %s)", async (force, reload) => {
    let online = !reload;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    const payload = "Keep this chosen destination";
    const raw = `  /${force} ${payload} \n`;
    const requests: Array<{ force?: string }> = [];
    stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) === "/api/intention") return Response.json({
        expandedIntention: payload, recommendedActions: [], counterIntentions: [], via: "synthetic",
      });
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      const request = JSON.parse(String(init?.body));
      requests.push(request);
      const response = await responseFor(request.captureId, payload).json();
      response.recovery.kind = force === "action" ? "intention" : "action";
      if (force !== "action") response.routingPlan.items[0] = {
        ...response.routingPlan.items[0], kind: force === "thread" ? "developing_thought" : "intention",
        action: null, destinations: force === "thread" ? [{ type: "existing", threadId: "destination" }] : [],
      };
      return Response.json(response);
    }));
    let hook = await mount();
    act(() => hook.result.current.setText(raw));
    await act(async () => { await hook.result.current.submit(); });
    if (reload) {
      hook.unmount();
      online = true;
      hook = await mount();
    }
    if (force === "intention") {
      await waitFor(() => expect(hook.result.current.draft?.rawInput).toBe(payload));
      await act(async () => { await hook.result.current.saveDraft(); });
    }
    await waitFor(() => expect(hook.result.current.unsorted).toHaveLength(0));
    expect(requests).toEqual(force === "intention" && !reload ? [] : [expect.objectContaining({ force })]);
    expect(hook.result.current.data.ledger.filter((entry) => !entry.undone))
      .toEqual([expect.objectContaining({ kind: force, raw, clean: payload })]);
  });


  it.each(["action", "thread", "intention"] as const)(
    "preserves exact /%s command provenance including outer whitespace",
    async (force) => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      stubSortFetch(vi.fn());
      const hook = await mount();
      const raw = `  /${force}  Keep Unicode — exactly. \n`;
      act(() => hook.result.current.setText(raw));
      await act(async () => { await hook.result.current.submit(); });
      expect(hook.result.current.data.ledger.find((entry) => entry.kind === "pending"))
        .toMatchObject({ raw, pendingSource: "Keep Unicode — exactly." });
      expect(hook.result.current.unsorted[0]).toMatchObject({ pendingForce: force });
    },
  );


  it.each(["action", "thread", "intention"] as const)(
    "carries /%s authority into explicit Sort now after reload",
    async (force) => {
      let online = false;
      vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
      const requests: Array<{ force?: string }> = [];
      stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
        if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
        requests.push(JSON.parse(String(init?.body)));
        return sortedResponse("A model override", force === "action" ? "intention" : "action");
      }));
      const hook = await mount();
      act(() => hook.result.current.setText(`/${force} Keep the commanded destination`));
      await act(async () => { await hook.result.current.submit(); });
      hook.unmount();
      const reopened = await mount();
      online = true;
      await act(async () => { await reopened.result.current.resort(reopened.result.current.unsorted[0]); });
      expect(requests).toEqual([expect.objectContaining({ force })]);
      expect(reopened.result.current.unsorted).toHaveLength(1);
      expect(reopened.result.current.data.intentions).toHaveLength(0);
      expect(reopened.result.current.draft).toBeNull();
    },
  );


  it.each([
    ["action", "immediate"], ["thread", "immediate"],
    ["action", "reload"], ["thread", "reload"],
    ["action", "online wake"], ["thread", "online wake"],
  ] as const)("retains /%s authority through %s and rejects a contradictory final plan", async (force, mode) => {
    let online = mode === "immediate";
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    const payload = "Preserve this exact destination";
    const raw = `/${force} ${payload}`;
    const requests: Array<{ raw: string; force?: string }> = [];
    stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      const request = JSON.parse(String(init?.body));
      requests.push(request);
      const response = await responseFor(request.captureId, payload).json();
      response.recovery.kind = force;
      if (force === "action") response.routingPlan.items[0] = {
        ...response.routingPlan.items[0], kind: "developing_thought", action: null,
        destinations: [{ type: "existing", threadId: "destination" }],
      };
      return Response.json(response);
    }));
    let hook = await mount();
    act(() => hook.result.current.setText(raw));
    await act(async () => { await hook.result.current.submit(); });
    expect(hook.result.current.unsorted[0]).toMatchObject({ pendingForce: force, src: payload });
    expect(parsePendingRecoveryRecords(await storage.get(PENDING_RECOVERY_KEY)))
      .toEqual([expect.objectContaining({ force, source: payload })]);
    if (mode === "reload") {
      hook.unmount();
      online = true;
      hook = await mount();
    } else if (mode === "online wake") {
      online = true;
      await act(async () => { window.dispatchEvent(new Event("online")); });
    }
    await waitFor(() => expect(requests).toHaveLength(2));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(requests[0]).toMatchObject({ raw: payload, force });
    expect(hook.result.current.unsorted).toEqual([expect.objectContaining({ src: payload, pendingForce: force })]);
    expect(hook.result.current.data.ledger.filter((entry) => !entry.undone))
      .toEqual([expect.objectContaining({ kind: "pending", raw })]);
    expect(hook.result.current.data.threads[0].frags).toHaveLength(0);
    expect(hook.result.current.draft).toBeNull();
  });


  it.each(["action", "thread", "mixed"] as const)(
    "settles final %s plan despite advisory initial Intention",
    async (kind) => {
      const raw = "Call the dentist. My intention: I protect quiet mornings.";
      const network = vi.fn(async (url: unknown, init?: RequestInit) => {
        if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
        const request = JSON.parse(String(init?.body));
        const response = await responseFor(request.captureId, raw).json();
        response.recovery.kind = "intention";
        if (kind === "thread") {
          response.routingPlan.items[0] = {
            ...response.routingPlan.items[0], kind: "developing_thought", action: null,
            destinations: [{ type: "existing", threadId: "destination" }],
          };
        } else if (kind === "mixed") {
          const base = response.routingPlan.items[0];
          response.routingPlan.items = [
            { ...base, source: "Call the dentist. ", action: "Call the dentist" },
            { ...base, id: "intention-one", source: "My intention: I protect quiet mornings.", kind: "intention", action: null },
          ];
        }
        return Response.json(response);
      });
      stubSortFetch(network);
      const hook = await mount();
      act(() => hook.result.current.setText(raw));
      await act(async () => { await hook.result.current.submit(); });
      await waitFor(() => expect(hook.result.current.unsorted).toHaveLength(0));
      const detailRequests = network.mock.calls.filter(([url]) => String(url) === "/api/intention");
      expect(detailRequests.map(([, init]) => JSON.parse(String(init?.body)).rawInput))
        .toEqual(kind === "mixed" ? ["My intention: I protect quiet mornings."] : []);
      expect(hook.result.current.draft).toBeNull();
      expect(hook.result.current.data.actions.filter((item) => !item.unsorted))
        .toHaveLength(kind === "thread" ? 0 : 1);
      expect(hook.result.current.data.intentions).toHaveLength(kind === "mixed" ? 1 : 0);
      expect(hook.result.current.data.threads[0].frags).toHaveLength(kind === "thread" ? 1 : 0);
      expect(hook.result.current.tab).toBe(kind === "thread" ? "threads" : "actions");
    },
  );


  it.each([
    ["JSON null", "null"],
    ["a number", "42"],
    ["a string", JSON.stringify("not a Board")],
    ["an empty object", "{}"],
    ["non-array actions", JSON.stringify({ actions: {}, threads: [] })],
    ["non-array threads", JSON.stringify({ actions: [], threads: "wrong" })],
    ["non-array optional collections", JSON.stringify({ actions: [], threads: [], ledger: {} })],
    ["a non-object Action", JSON.stringify({ actions: [42], threads: [] })],
    ["a Thread with non-array fragments", JSON.stringify({
      actions: [], threads: [{ id: "thread", name: "Thread", summary: "", frags: {} }],
    })],
    ["a malformed ledger row", JSON.stringify({ actions: [], threads: [], ledger: [42] })],
    ["a structurally incomplete ledger row", JSON.stringify({
      actions: [], threads: [], ledger: [{ id: "ledger", at: 1 }],
    })],
    ["a ledger row with an invalid source", JSON.stringify({
      actions: [], threads: [], ledger: [{
        id: "ledger", at: 1, raw: "raw", clean: "clean", kind: "action",
        source: "telepathy", targetId: "action",
      }],
    })],
    ["a correction missing semantic context", JSON.stringify({
      actions: [], threads: [], corrections: [{
        id: "correction", at: 1, proposalKind: "refiled", accepted: true,
        routing: { kind: "thread", threadId: "thread" },
      }],
    })],
    ["a correction with malformed routing", JSON.stringify({
      actions: [], threads: [], corrections: [{
        id: "correction", at: 1, proposalKind: "refiled", accepted: true,
        context: "Keep the full semantic source", routing: { kind: "thread", threadId: 42 },
      }],
    })],
    ["a malformed profile", JSON.stringify({ actions: [], threads: [], profile: { imageId: "orphan" } })],
    ["malformed command authority", JSON.stringify({
      actions: [{ id: "pending", text: "Pending", at: 1, pendingForce: "both" }], threads: [],
    })],
    ["malformed durable routing authority", JSON.stringify({
      actions: [], threads: [], routingSettlements: [{
        id: "settlement", captureId: "capture", pendingId: "pending", revision: "one",
        settledBy: "manual", artifacts: [],
      }],
    })],
    ["durable routing authority without a live owned artifact", JSON.stringify({
      actions: [{
        id: "unrelated", text: "Unrelated", done: false, at: 1,
        shelf: "keep", expires: null,
      }],
      threads: [],
      routingSettlements: [{
        id: "settlement", captureId: "capture", pendingId: "pending", revision: 1,
        settledBy: "manual", artifacts: [{ kind: "action", id: "missing" }],
      }],
    })],
    ["duplicate durable routing authority identity", JSON.stringify({
      actions: [{
        id: "owned", text: "Owned", done: false, at: 1,
        shelf: "keep", expires: null,
      }],
      threads: [],
      routingSettlements: ["first", "second"].map(() => ({
        id: "settlement", captureId: "capture", pendingId: "pending", revision: 1,
        settledBy: "manual", artifacts: [{ kind: "action", id: "owned" }],
      })),
    })],
    ["malformed durable routing retirement", JSON.stringify({
      actions: [], threads: [], routingRetirements: [{
        captureId: "capture", pendingId: "pending\u0000slot", revision: 1, retiredAt: 1,
      }],
    })],
  ])("quarantines %s as an invalid persisted Board before replacing it", async (_case, raw) => {
    await storage.set(KEY, raw);
    const hook = await mount();

    expect(hook.result.current.corrupt).toBe(true);
    expect(await storage.get(CORRUPT)).toBe(raw);
    expect(JSON.parse((await storage.get(KEY))!)).toMatchObject({ actions: [], threads: [] });
  });

  it("accepts the oldest supported persisted Board envelope and hydrates its missing fields", async () => {
    const legacy = JSON.stringify({
      actions: [{ id: "legacy-action", text: "Legacy open item", at: 1 }],
      threads: [{ id: "legacy", name: "Legacy", summary: "", frags: [] }],
    });
    await storage.set(KEY, legacy);

    const hook = await mount();

    expect(hook.result.current.corrupt).toBe(false);
    expect(hook.result.current.data.threads).toEqual([
      expect.objectContaining({ id: "legacy", name: "Legacy", frags: [] }),
    ]);
    expect(hook.result.current.data.intentions).toEqual([]);
    expect(hook.result.current.data.ledger).toEqual([]);
  });

  it("accepts a complete current Board and preserves correction context for semantic examples", async () => {
    const retirementAt = Date.now();
    const current = JSON.stringify({
      ...EMPTY,
      principles: [],
      actions: [{
        id: "action", text: "Keep the current action", done: false, at: 1,
        shelf: "keep", expires: null, updatedAt: 1,
      }],
      threads: [{
        id: "thread", name: "Current thread", summary: "A current boundary", updatedAt: 1,
        frags: [{ id: "frag", at: 1, text: "Current thought", updatedAt: 1 }],
      }],
      ledger: [{
        id: "ledger", at: 1, raw: "Keep the current action", clean: "Keep the current action",
        kind: "action", source: "typed", targetId: "action", settledBy: "automatic",
      }],
      corrections: [{
        id: "correction", at: 2, proposalKind: "refiled", accepted: true,
        context: "Keep the complete semantic correction context",
        routing: { kind: "thread", threadId: "thread", threadName: "Current thread" },
      }],
      wraps: [{
        day: "2026-09-26", at: 3,
        stats: {
          day: "2026-09-26", said: 3, threadsMoved: 1, actionsMade: 1, intentions: 0,
          threads: [{ name: "Current thread", n: 2 }], firstAt: 1, lastAt: 3,
          finished: [{ text: "Finished item", at: 2 }], returns: [1, 3],
        },
        line: "A complete day.", insights: [{ k: "Focus", v: "Stayed coherent." }],
        tomorrow: "Continue.", seen: false,
      }],
      completions: [{ id: "done", text: "Finished item", at: 2, threadId: "thread" }],
      historyEpoch: 4,
      historyImports: { import1: "accepted" },
      profile: { name: "Ada", imageId: "portrait", showSignature: true, updatedAt: 5 },
      routingSettlements: [{
        id: "settlement", captureId: "capture", pendingId: "pending", revision: 1,
        settledBy: "manual", artifacts: [{ kind: "action", id: "action" }],
      }],
      routingRetirements: [{
        captureId: "capture", pendingId: "retired-pending", revision: 2, retiredAt: retirementAt,
      }],
    });
    await storage.set(KEY, current);

    const hook = await mount();

    expect(hook.result.current.corrupt).toBe(false);
    expect(hook.result.current.data.corrections).toEqual([
      expect.objectContaining({
        id: "correction",
        context: "Keep the complete semantic correction context",
        routing: { kind: "thread", threadId: "thread", threadName: "Current thread" },
      }),
    ]);
    expect(hook.result.current.data.routingSettlements).toEqual([{
      id: "settlement",
      captureId: "capture",
      pendingId: "pending",
      revision: 1,
      settledBy: "manual",
      artifacts: [{ kind: "action", id: "action" }],
    }]);
    expect(hook.result.current.data.routingRetirements).toEqual(expect.arrayContaining([
      {
        captureId: "capture",
        pendingId: "retired-pending",
        revision: 2,
        retiredAt: retirementAt,
      },
      expect.objectContaining({
        captureId: "capture",
        pendingId: "pending",
        revision: 1,
      }),
    ]));
    expect(deriveCorrectionExamples(
      hook.result.current.data.corrections,
      hook.result.current.data.threads,
    )).toEqual([
      expect.objectContaining({
        capture: "Keep the complete semantic correction context",
        kind: "thread",
        threadId: "thread",
      }),
    ]);
  });

  it("fails closed on an invalid Board shape when exact-byte quarantine does not persist", async () => {
    const invalidBoard = JSON.stringify({ actions: [], threads: { wrong: true } });
    await storage.set(KEY, invalidBoard);
    const realSet = storage.set;
    vi.spyOn(storage, "set").mockImplementation((key, value) =>
      key === CORRUPT
        ? Promise.reject(new DOMException("quota", "QuotaExceededError"))
        : realSet(key, value));
    const writes = vi.spyOn(storage, "setMany");
    const network = vi.fn();
    stubSortFetch(network);

    const hook = renderHook(() => useBoard(Date.now()));
    await waitFor(() => expect(hook.result.current.err)
      .toBe("Couldn't finish opening your saved board. Nothing new was written."));

    act(() => hook.result.current.setText("Blocked while invalid bytes are authoritative"));
    await act(async () => {
      await hook.result.current.submit();
      await hook.result.current.syncNow();
    });

    expect(hook.result.current.loaded).toBe(false);
    expect(hook.result.current.corrupt).toBe(false);
    expect(writes).not.toHaveBeenCalled();
    expect(await storage.get(KEY)).toBe(invalidBoard);
    expect(await storage.get(CORRUPT)).toBeNull();
    expect(network).not.toHaveBeenCalled();
    expect(hook.result.current.text).toBe("Blocked while invalid bytes are authoritative");
  });

  it("fails closed on a transient Board read failure without replacing state or enabling intake or sync", async () => {
    const original = JSON.stringify({
      ...EMPTY,
      principles: [],
      actions: [{
        id: "saved-action", text: "Must remain exact", done: false, at: 10,
        shelf: "keep", expires: null,
      }],
    });
    await storage.set(KEY, original);
    const realGet = storage.get;
    vi.spyOn(storage, "get").mockImplementation((key) =>
      key === KEY ? Promise.reject(new DOMException("temporary read failure", "UnknownError")) : realGet(key));
    const writes = vi.spyOn(storage, "setMany");
    const network = vi.fn();
    stubSortFetch(network);

    const hook = renderHook(() => useBoard(Date.now()));
    await waitFor(() => expect(hook.result.current.err)
      .toBe("Couldn't finish opening your saved board. Nothing new was written."));
    expect(hook.result.current.loaded).toBe(false);
    expect(hook.result.current.data).toEqual(EMPTY);

    act(() => hook.result.current.setText("Do not accept this while recovery is blocked"));
    await act(async () => {
      await hook.result.current.submit();
      await hook.result.current.syncNow();
    });

    expect(writes).not.toHaveBeenCalled();
    expect(await realGet(KEY)).toBe(original);
    expect(network).not.toHaveBeenCalled();
    expect(hook.result.current.text).toBe("Do not accept this while recovery is blocked");
  });

  it("fails closed on malformed tombstones without replacing them or allowing sync resurrection", async () => {
    const originalBoard = (await storage.get(KEY))!;
    const malformedTombstones = "{not valid tombstones";
    await storage.set(TOMBSTONE_KEY, malformedTombstones);
    const writes = vi.spyOn(storage, "setMany");
    const network = vi.fn();
    stubSortFetch(network);

    const hook = renderHook(() => useBoard(Date.now()));
    await waitFor(() => expect(hook.result.current.err)
      .toBe("Couldn't finish opening your saved board. Nothing new was written."));
    expect(hook.result.current.loaded).toBe(false);

    await act(async () => { await hook.result.current.syncNow(); });

    expect(writes).not.toHaveBeenCalled();
    expect(await storage.get(KEY)).toBe(originalBoard);
    expect(await storage.get(TOMBSTONE_KEY)).toBe(malformedTombstones);
    expect(network).not.toHaveBeenCalled();
  });

  it("fails closed when an unreadable Board cannot be quarantined", async () => {
    const unreadableBoard = "{not valid board";
    const originalTombstones = JSON.stringify([
      { kind: "action", id: "deleted-action", deletedAt: 20 },
    ]);
    await storage.set(KEY, unreadableBoard);
    await storage.set(TOMBSTONE_KEY, originalTombstones);
    const realSet = storage.set;
    vi.spyOn(storage, "set").mockImplementation((key, value) =>
      key === CORRUPT
        ? Promise.reject(new DOMException("quota", "QuotaExceededError"))
        : realSet(key, value));
    const writes = vi.spyOn(storage, "setMany");
    const network = vi.fn();
    stubSortFetch(network);

    const hook = renderHook(() => useBoard(Date.now()));
    await waitFor(() => expect(hook.result.current.err)
      .toBe("Couldn't finish opening your saved board. Nothing new was written."));
    expect(hook.result.current.loaded).toBe(false);
    expect(hook.result.current.corrupt).toBe(false);

    await act(async () => { await hook.result.current.syncNow(); });

    expect(writes).not.toHaveBeenCalled();
    expect(await storage.get(KEY)).toBe(unreadableBoard);
    expect(await storage.get(TOMBSTONE_KEY)).toBe(originalTombstones);
    expect(await storage.get(CORRUPT)).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });

  it("gates Capture behind atomic startup Board+tombstone persistence and tombstones swept artifacts", async () => {
    const now = Date.now();
    await storage.set(KEY, JSON.stringify({
      ...EMPTY,
      principles: [],
      actions: [
        {
          id: "fresh-on-disk", text: "Keep this", done: false, at: now,
          updatedAt: now, shelf: "keep", expires: null,
        },
        {
          id: "expired-on-disk", text: "Sweep this", done: false, at: now - 30_000,
          updatedAt: now - 30_000, shelf: "days", expires: now - 20_000,
          faded: true, fadedAt: now - 15 * 24 * 60 * 60 * 1000,
        },
      ],
    }));
    await storage.set(TOMBSTONE_KEY, JSON.stringify([
      { kind: "thread", id: "remote-delete", deletedAt: now - 1_000 },
    ]));

    const startupWrite = deferred<void>();
    const startupStarted = deferred<void>();
    const realSet = storage.set;
    const realSetMany = storage.setMany;
    const isStartupBoard = (raw: string) => {
      const board = JSON.parse(raw);
      return board.actions?.some((action: { id: string }) => action.id === "fresh-on-disk") &&
        !board.actions?.some((action: { id: string }) => action.id === "expired-on-disk") &&
        !board.actions?.some((action: { unsorted?: boolean }) => action.unsorted);
    };
    vi.spyOn(storage, "set").mockImplementation(async (key, value) => {
      if (key === KEY && isStartupBoard(value)) {
        startupStarted.resolve();
        await startupWrite.promise;
      }
      return realSet(key, value);
    });
    vi.spyOn(storage, "setMany").mockImplementation(async (entries) => {
      const boardRaw = entries.find(([key]) => key === KEY)?.[1];
      if (boardRaw && isStartupBoard(boardRaw)) {
        startupStarted.resolve();
        await startupWrite.promise;
      }
      return realSetMany(entries);
    });
    const sortWait = deferred<Response>();
    const network = vi.fn(async (url: unknown) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      return sortWait.promise;
    });
    stubSortFetch(network);

    const hook = renderHook(() => useBoard(now));
    await startupStarted.promise;
    expect(hook.result.current.loaded).toBe(false);
    expect(hook.result.current.data.actions).toHaveLength(0);

    act(() => hook.result.current.setText("Capture while startup durability waits"));
    let submit!: Promise<unknown>;
    act(() => { submit = hook.result.current.submit(); });
    await Promise.resolve();
    expect(network.mock.calls.filter(([url]) => String(url) === "/api/sort")).toHaveLength(0);
    expect(hook.result.current.unsorted).toHaveLength(0);

    await act(async () => {
      startupWrite.resolve();
      await submit;
    });
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    expect(hook.result.current.data.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "fresh-on-disk", text: "Keep this" }),
      expect.objectContaining({ text: "Capture while startup durability waits", unsorted: true }),
    ]));
    expect(hook.result.current.data.actions.some((action) => action.id === "expired-on-disk")).toBe(false);
    expect(JSON.parse((await storage.get(TOMBSTONE_KEY))!)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "thread", id: "remote-delete" }),
      expect.objectContaining({ kind: "action", id: "expired-on-disk" }),
    ]));
  });

  it("keeps composer text and attachments and shows no receipt when durable storage fails", async () => {
    const network = vi.fn();
    stubSortFetch(network);
    const hook = await mount();
    vi.spyOn(storage, "setMany").mockRejectedValueOnce(new DOMException("quota", "QuotaExceededError"));
    act(() => {
      hook.result.current.setText("Storage must win first");
      hook.result.current.setTranscript("Storage must, um, win first");
      hook.result.current.setPics([{ id: "photo-fail", src: "data:image/png;base64,fail" }]);
    });

    await act(async () => { await hook.result.current.submit(true); });

    expect(hook.result.current.text).toBe("Storage must win first");
    expect(hook.result.current.pics).toEqual([{ id: "photo-fail", src: "data:image/png;base64,fail" }]);
    expect(hook.result.current.captureDictated).toBe(true);
    expect(hook.result.current.landed).toBeNull();
    expect(hook.result.current.unsorted).toHaveLength(0);
    expect(network.mock.calls.filter(([url]) => String(url) === "/api/sort")).toHaveLength(0);
  });

  it.each([
    {
      case: "keeps an attachment edited under the same id",
      duringWrite: (current: { id: string; src: string }[]) =>
        current.map((picture) => ({ ...picture, src: "data:image/png;base64,edited" })),
      expected: [{ id: "intake-photo", src: "data:image/png;base64,edited" }],
      reminted: true,
    },
    {
      case: "does not restore an attachment removed during persistence",
      duringWrite: () => [],
      expected: [],
    },
    {
      case: "clears only the persisted attachment when a new one is added during persistence",
      duringWrite: (current: { id: string; src: string }[]) => [
        ...current,
        { id: "new-during-write", src: "data:image/png;base64,new" },
      ],
      expected: [{ id: "new-during-write", src: "data:image/png;base64,new" }],
    },
  ])("$case", async ({ duringWrite, expected, reminted }) => {
    stubSortFetch(vi.fn());
    const hook = await mount();
    act(() => {
      hook.result.current.setText("Persist the exact attachment snapshot");
      hook.result.current.setPics([{
        id: "intake-photo",
        src: "data:image/png;base64,original",
      }]);
    });
    const delayedWrite = deferred<void>();
    const writeStarted = deferred<void>();
    const realSetMany = storage.setMany;
    vi.spyOn(storage, "setMany").mockImplementationOnce(async (entries, guard) => {
      writeStarted.resolve();
      await delayedWrite.promise;
      return realSetMany(entries, guard);
    });

    let submit!: Promise<unknown>;
    act(() => { submit = hook.result.current.submit(); });
    await writeStarted.promise;
    act(() => hook.result.current.setPics(duringWrite));
    await act(async () => {
      delayedWrite.resolve();
      await submit;
    });

    expect(hook.result.current.pics.map(({ src }) => ({ src })))
      .toEqual(expected.map(({ src }) => ({ src })));
    if (reminted) expect(hook.result.current.pics[0].id).not.toBe("intake-photo");
    expect(await storage.get(IMG("intake-photo"))).toBe("data:image/png;base64,original");
    expect(hook.result.current.busy).toBeNull();
  });

  it("remints an attachment edited during durable intake before a second submission and keeps retries idempotent", async () => {
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    const network = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      const body = JSON.parse(String(init?.body));
      return sortedResponse(body.raw);
    });
    stubSortFetch(network);
    const hook = await mount();
    act(() => {
      hook.result.current.setText("First immutable photo");
      hook.result.current.setPics([{
        id: "shared-composer-id",
        src: "data:image/png;base64,original-bytes",
      }]);
    });
    const delayedWrite = deferred<void>();
    const writeStarted = deferred<void>();
    const realSetMany = storage.setMany;
    vi.spyOn(storage, "setMany").mockImplementationOnce(async (entries, guard) => {
      writeStarted.resolve();
      await delayedWrite.promise;
      return realSetMany(entries, guard);
    });

    let firstSubmit!: Promise<unknown>;
    act(() => { firstSubmit = hook.result.current.submit(); });
    await writeStarted.promise;
    act(() => {
      hook.result.current.setText("Second immutable photo");
      hook.result.current.setPics([{
        id: "shared-composer-id",
        src: "data:image/png;base64,edited-bytes",
      }]);
    });
    await act(async () => {
      delayedWrite.resolve();
      await firstSubmit;
    });

    expect(hook.result.current.pics).toEqual([
      expect.objectContaining({ src: "data:image/png;base64,edited-bytes" }),
    ]);
    const secondImageId = hook.result.current.pics[0].id;
    expect(secondImageId).not.toBe("shared-composer-id");
    await act(async () => { await hook.result.current.submit(); });

    const pending = [...hook.result.current.unsorted];
    expect(pending).toHaveLength(2);
    const first = pending.find((item) => item.text === "First immutable photo")!;
    const second = pending.find((item) => item.text === "Second immutable photo")!;
    expect(first.imgs).toEqual(["shared-composer-id"]);
    expect(second.imgs).toEqual([secondImageId]);
    expect(await storage.get(IMG("shared-composer-id")))
      .toBe("data:image/png;base64,original-bytes");
    expect(await storage.get(IMG(secondImageId)))
      .toBe("data:image/png;base64,edited-bytes");

    online = true;
    await act(async () => {
      await hook.result.current.resort(first);
      await hook.result.current.resort(second);
    });
    expect(network.mock.calls.filter(([url]) => String(url) === "/api/sort")).toHaveLength(2);
    await act(async () => {
      await hook.result.current.resort(first);
      await hook.result.current.resort(second);
    });

    expect(network.mock.calls.filter(([url]) => String(url) === "/api/sort")).toHaveLength(4);
    expect(hook.result.current.unsorted).toHaveLength(0);
    const settled = hook.result.current.data.actions.filter((action) =>
      ["First immutable photo", "Second immutable photo"].includes(action.text)
    );
    expect(settled).toHaveLength(2);
    const ownerImages = settled.map((action) => {
      const owner = hook.result.current.data.threads.find((thread) => thread.id === action.shot?.threadId);
      return owner?.frags.find((frag) => frag.id === action.shot?.fragId)?.imgs;
    });
    expect(ownerImages).toEqual(expect.arrayContaining([
      ["shared-composer-id"],
      [secondImageId],
    ]));
    expect(await storage.get(IMG("shared-composer-id")))
      .toBe("data:image/png;base64,original-bytes");
    expect(await storage.get(IMG(secondImageId)))
      .toBe("data:image/png;base64,edited-bytes");

    hook.unmount();
    const reloaded = await mount();
    expect(reloaded.result.current.data.actions.filter((action) =>
      ["First immutable photo", "Second immutable photo"].includes(action.text)
    )).toHaveLength(2);
    expect(reloaded.result.current.data.threads.flatMap((thread) => thread.frags)
      .flatMap((frag) => frag.imgs ?? []).sort()).toEqual([
        "shared-composer-id",
        secondImageId,
      ].sort());
  });

  it("persists pending before fetch, shows it immediately, and permits navigation and a second capture", async () => {
    const replies = [deferred<Response>(), deferred<Response>()];
    const persistedAtFetch: string[] = [];
    const network = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      const request = JSON.parse(String(init?.body));
      const persisted = JSON.parse((await storage.get(KEY))!);
      persistedAtFetch.push(persisted.ledger.find((entry: { captureId?: string }) =>
        entry.captureId === request.captureId)?.kind ?? "missing");
      return replies[persistedAtFetch.length - 1].promise;
    });
    stubSortFetch(network);
    const hook = await mount();

    act(() => hook.result.current.setText("First thought stays usable"));
    await act(async () => { await hook.result.current.submit(); });
    expect(hook.result.current.unsorted.map((item) => item.text)).toEqual(["First thought stays usable"]);
    expect(hook.result.current.text).toBe("");
    expect(hook.result.current.busy).toBeNull();
    expect(hook.result.current.landed).toBeTruthy();
    await waitFor(() => expect(persistedAtFetch).toEqual(["pending"]));

    act(() => {
      hook.result.current.setTab("threads");
      hook.result.current.setShowSettings(true);
      hook.result.current.setText("Second thought while the first sorts");
    });
    await act(async () => { await hook.result.current.submit(); });

    expect(hook.result.current.tab).toBe("threads");
    expect(hook.result.current.showSettings).toBe(true);
    expect(hook.result.current.unsorted.map((item) => item.text)).toEqual([
      "Second thought while the first sorts",
      "First thought stays usable",
    ]);
    await waitFor(() => expect(persistedAtFetch).toEqual(["pending", "pending"]));
    expect(network.mock.calls.filter(([url]) => String(url) === "/api/sort")).toHaveLength(2);
  });

  it.each([
    ["provider", () => new Response(null, { status: 503 })],
    ["malformed", () => Response.json({ planned: true, captureId: "wrong", recovery: {} })],
  ])("leaves one exact pending capture after a %s failure", async (_kind, reply) => {
    stubSortFetch(vi.fn(async () => reply()));
    const hook = await mount();
    act(() => hook.result.current.setText("Exact source survives failure"));
    await act(async () => { await hook.result.current.submit(); });

    await waitFor(() => expect(hook.result.current.landed).toBe("Saved. Awaiting sorting or placement"));
    expect(hook.result.current.err).toBe("");
    expect(hook.result.current.unsorted).toEqual([
      expect.objectContaining({ text: "Exact source survives failure", src: "Exact source survives failure" }),
    ]);
    const persisted = JSON.parse((await storage.get(KEY))!);
    expect(persisted.actions.filter((item: { unsorted?: boolean }) => item.unsorted)).toHaveLength(1);
  });

  it("does not request a provider while offline and preserves the exact pending capture", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const network = vi.fn();
    stubSortFetch(network);
    const hook = await mount();
    act(() => hook.result.current.setText("Offline exact source"));
    await act(async () => { await hook.result.current.submit(); });

    expect(network.mock.calls.filter(([url]) => String(url) === "/api/sort")).toHaveLength(0);
    expect(hook.result.current.unsorted).toEqual([
      expect.objectContaining({ text: "Offline exact source", src: "Offline exact source" }),
    ]);
    const records = parsePendingRecoveryRecords(await storage.get(PENDING_RECOVERY_KEY));
    expect(records).toEqual([
      expect.objectContaining({
        pendingId: expect.any(String),
        captureId: expect.any(String),
        targetId: hook.result.current.unsorted[0].id,
        revision: 1,
        source: "Offline exact source",
        inputSource: "typed",
        imageIds: [],
        automaticAttempts: 0,
      }),
    ]);
  });

  it("durably consumes the immediate bounded attempt before provider failure", async () => {
    const started = Date.now();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    stubSortFetch(vi.fn(async () => new Response(null, { status: 503 })));
    const hook = await mount();
    act(() => hook.result.current.setText("Provider failure is durably bounded"));

    await act(async () => { await hook.result.current.submit(); });
    await waitFor(() => expect(hook.result.current.landed)
      .toBe("Saved. Awaiting sorting or placement"));
    expect(hook.result.current.err).toBe("");

    const records = parsePendingRecoveryRecords(await storage.get(PENDING_RECOVERY_KEY));
    expect(records).toEqual([
      expect.objectContaining({
        targetId: hook.result.current.unsorted[0].id,
        automaticAttempts: 1,
      }),
    ]);
    expect(records[0].nextAttemptAt).toBeGreaterThanOrEqual(started + PENDING_RECOVERY_BACKOFF_MS);
  });

  it("provider timeout after local save releases without losing or globally blocking the capture", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    stubSortFetch(vi.fn((url: unknown) =>
      String(url) === "/api/sort"
        ? Promise.reject(new DOMException("provider timeout", "TimeoutError"))
        : Promise.resolve(new Response(null, { status: 503 }))));
    const hook = await mount();
    act(() => hook.result.current.setText("Timeout happens after durable save"));
    await act(async () => { await hook.result.current.submit(); });
    await waitFor(() => expect(hook.result.current.landed)
      .toBe("Saved. Awaiting sorting or placement"));
    expect(hook.result.current.err).toBe("");

    expect(hook.result.current.unsorted).toEqual([
      expect.objectContaining({ text: "Timeout happens after durable save", unsorted: true }),
    ]);
    expect(hook.result.current.text).toBe("");
    expect(hook.result.current.busy).toBeNull();
    expect(parsePendingRecoveryRecords(await storage.get(PENDING_RECOVERY_KEY)))
      .toEqual([expect.objectContaining({ automaticAttempts: 1 })]);
  });

  it("sends the stripped slash-command payload to planned sorting while retaining exact raw provenance", async () => {
    const waiting = deferred<Response>();
    let request: { raw: string; force?: string } | undefined;
    stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      request = JSON.parse(String(init?.body));
      return waiting.promise;
    }));
    const hook = await mount();
    act(() => hook.result.current.setText("/action Send the release note"));

    await act(async () => { await hook.result.current.submit(); });
    await waitFor(() => expect(request).toMatchObject({
      raw: "Send the release note",
      force: "action",
    }));

    expect(hook.result.current.unsorted).toEqual([
      expect.objectContaining({
        text: "Send the release note",
        src: "Send the release note",
      }),
    ]);
    expect(hook.result.current.data.ledger.find((entry) => entry.kind === "pending"))
      .toMatchObject({
        raw: "/action Send the release note",
        clean: "Send the release note",
        pendingSource: "Send the release note",
      });
  });

  it("keeps an online /intention prefix only in raw Record provenance", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    stubSortFetch(vi.fn(async (url: unknown) =>
      String(url) === "/api/intention"
        ? Response.json({
            expandedIntention: "I protect unhurried mornings",
            recommendedActions: [],
            counterIntentions: [],
            via: "synthetic-intention",
          })
        : new Response(null, { status: 503 })));
    const hook = await mount();
    const command = "/intention I protect unhurried mornings";
    const payload = "I protect unhurried mornings";
    act(() => hook.result.current.setText(command));
    await act(async () => { await hook.result.current.submit(); });
    await waitFor(() => expect(hook.result.current.draft?.rawInput).toBe(payload));

    await act(async () => { await hook.result.current.saveDraft(); });

    expect(hook.result.current.data.intentions[0]).toMatchObject({
      rawInput: payload,
      expandedIntention: payload,
    });
    expect(hook.result.current.data.ledger.find((entry) =>
      entry.kind === "intention" && !entry.undone
    )).toMatchObject({
      raw: command,
      clean: payload,
    });
  });

  it.each([
    {
      command: "/action Call the dentist",
      payload: "Call the dentist",
      destination: { kind: "action" } as const,
      classified: (hook: Awaited<ReturnType<typeof mount>>) => ({
        text: hook.result.current.data.actions.find((action) => !action.unsorted)?.text,
      }),
      expected: { text: "Call the dentist" },
    },
    {
      command: "/thread Release routing notes",
      payload: "Release routing notes",
      destination: { kind: "thread", threadId: null } as const,
      classified: (hook: Awaited<ReturnType<typeof mount>>) => ({
        text: hook.result.current.data.threads.find((thread) => thread.temporaryName)?.frags[0]?.text,
      }),
      expected: { text: "Release routing notes" },
    },
    {
      command: "/intention I protect unhurried mornings",
      payload: "I protect unhurried mornings",
      destination: { kind: "intention" } as const,
      classified: (hook: Awaited<ReturnType<typeof mount>>) => ({
        rawInput: hook.result.current.data.intentions[0]?.rawInput,
        expandedIntention: hook.result.current.data.intentions[0]?.expandedIntention,
      }),
      expected: {
        rawInput: "I protect unhurried mornings",
        expandedIntention: "I protect unhurried mornings",
      },
    },
  ])("uses only the stripped payload for offline manual $destination.kind filing", async ({
    command, payload, destination, classified, expected,
  }) => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const network = vi.fn<(url: unknown) => Promise<Response>>(
      async () => new Response(null, { status: 503 }),
    );
    stubSortFetch(network);
    const hook = await mount();
    act(() => hook.result.current.setText(command));
    await act(async () => { await hook.result.current.submit(); });

    expect(network.mock.calls.filter(([url]) =>
      ["/api/sort", "/api/intention"].includes(String(url))
    )).toHaveLength(0);
    const pending = hook.result.current.unsorted[0];
    expect(pending).toMatchObject({ text: payload, src: payload });
    expect(hook.result.current.data.ledger.find((entry) => entry.kind === "pending"))
      .toMatchObject({ raw: command, clean: payload, pendingSource: payload });

    await act(async () => { await hook.result.current.manualSort(pending, destination); });

    expect(classified(hook)).toEqual(expected);
    expect(hook.result.current.data.ledger.find((entry) =>
      entry.kind === destination.kind && entry.settledBy === "manual"
    )).toMatchObject({ raw: command, clean: payload });
  });

  it("leaves ordinary planned and manual text unchanged", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    stubSortFetch(vi.fn());
    const hook = await mount();
    const ordinary = "Action items are part of this ordinary thought";
    act(() => hook.result.current.setText(ordinary));
    await act(async () => { await hook.result.current.submit(); });

    const pending = hook.result.current.unsorted[0];
    expect(pending).toMatchObject({ text: ordinary, src: ordinary });
    expect(hook.result.current.data.ledger.find((entry) => entry.kind === "pending"))
      .toMatchObject({ raw: ordinary, clean: ordinary, pendingSource: ordinary });

    await act(async () => {
      await hook.result.current.manualSort(pending, { kind: "action" });
    });
    expect(hook.result.current.data.actions.find((action) => !action.unsorted))
      .toMatchObject({ text: ordinary, src: ordinary });
  });

  it("automatically sorts online images with their complete durable bytes", async () => {
    const reply = deferred<Response>();
    const requests: Array<{ captureId?: string; imgs?: string[] }> = [];
    stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      requests.push(JSON.parse(String(init?.body)));
      return reply.promise;
    }));
    const hook = await mount();
    act(() => {
      hook.result.current.setText("Image task");
      hook.result.current.setPics([{ id: "automatic-image", src: "data:image/png;base64,image" }]);
    });
    await act(async () => { await hook.result.current.submit(); });
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ imgs: ["data:image/png;base64,image"] });
    expect(requests[0].captureId).toBeUndefined();
    expect(JSON.parse((await storage.get(PENDING_RECOVERY_KEY))!)[0].automaticAttempts).toBe(1);
    expect(hook.result.current.autoSortingIds).toEqual([hook.result.current.unsorted[0].id]);
    await act(async () => { reply.resolve(sortedResponse("Image task")); });
    await waitFor(() => expect(hook.result.current.unsorted).toHaveLength(0));
    expect(hook.result.current.autoSortingIds).toEqual([]);
    expect(await storage.get(IMG("automatic-image"))).toBe("data:image/png;base64,image");
  });

  it.each([
    ["image-only", ""],
    ["image-dependent", "Use the attached whiteboard diagram for this capture"],
  ])("keeps an offline %s capture pending with exact bytes", async (_case, source) => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const network = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      const request = JSON.parse(String(init?.body));
      return responseFor(request.captureId, request.raw);
    });
    stubSortFetch(network);
    const hook = await mount();
    act(() => {
      hook.result.current.setText(source);
      hook.result.current.setPics([{ id: `planned-image-${_case}`, src: "data:image/png;base64,planned" }]);
    });

    await act(async () => { await hook.result.current.submit(); });

    expect(network.mock.calls.filter(([url]) => String(url) === "/api/sort")).toHaveLength(0);
    expect(hook.result.current.err).toBe("");
    expect(hook.result.current.landed).toBe("Saved. Awaiting sorting or placement");
    const pendingCopy = source || "(image only)";
    expect(hook.result.current.unsorted).toEqual([
      expect.objectContaining({
        text: pendingCopy,
        src: pendingCopy,
        imgs: [`planned-image-${_case}`],
        unsorted: true,
      }),
    ]);
    expect(await storage.get(IMG(`planned-image-${_case}`))).toBe("data:image/png;base64,planned");
  });

  it("keeps the exact multi-image pending envelope when explicit Sort now cannot load every byte", async () => {
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    const network = vi.fn(async (url: unknown) =>
      String(url) === "/api/sort"
        ? Response.json({
            clean: "Use both attached diagrams",
            kind: "action",
            title: "Use both attached diagrams",
            actions: ["Use both attached diagrams"],
            shelfLife: "keep",
            due: null,
            threadId: null,
            threadName: null,
            primaryText: null,
            also: [],
          })
        : new Response(null, { status: 503 }));
    stubSortFetch(network);
    const hook = await mount();
    act(() => {
      hook.result.current.setText("Use both attached diagrams");
      hook.result.current.setPics([
        { id: "sort-image-one", src: "data:image/png;base64,one" },
        { id: "sort-image-two", src: "data:image/png;base64,two" },
      ]);
    });
    await act(async () => { await hook.result.current.submit(); });
    const pending = hook.result.current.unsorted[0];
    const pendingBefore = JSON.stringify(pending);
    await storage.del(IMG("sort-image-two"));
    online = true;

    await act(async () => { await hook.result.current.resort(pending); });

    expect(network.mock.calls.filter(([url]) => String(url) === "/api/sort")).toHaveLength(0);
    expect(JSON.stringify(hook.result.current.unsorted[0])).toBe(pendingBefore);
    expect(await storage.get(IMG("sort-image-one"))).toBe("data:image/png;base64,one");
    expect(await storage.get(IMG("sort-image-two"))).toBeNull();
    expect(hook.result.current.busy).toBeNull();
  });

  it("supplies every image byte to explicit Sort now before settlement", async () => {
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    let sortBody: { imgs?: string[] } | undefined;
    stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      sortBody = JSON.parse(String(init?.body));
      return Response.json({
        clean: "Use both complete images",
        kind: "action",
        title: "Use both complete images",
        actions: ["Use both complete images"],
        shelfLife: "keep",
        due: null,
        threadId: null,
        threadName: null,
        primaryText: null,
        also: [],
      });
    }));
    const hook = await mount();
    act(() => {
      hook.result.current.setText("Use both complete images");
      hook.result.current.setPics([
        { id: "complete-image-one", src: "data:image/png;base64,one" },
        { id: "complete-image-two", src: "data:image/png;base64,two" },
      ]);
    });
    await act(async () => { await hook.result.current.submit(); });
    const pending = hook.result.current.unsorted[0];
    online = true;

    await act(async () => { await hook.result.current.resort(pending); });

    expect(sortBody?.imgs).toEqual([
      "data:image/png;base64,one",
      "data:image/png;base64,two",
    ]);
    expect(hook.result.current.unsorted).toHaveLength(0);
    expect(hook.result.current.data.actions).toEqual([
      expect.objectContaining({ text: "Use both complete images" }),
    ]);
    expect(hook.result.current.data.threads.flatMap((thread) => thread.frags)
      .some((frag) => JSON.stringify(frag.imgs) === JSON.stringify([
        "complete-image-one",
        "complete-image-two",
      ]))).toBe(true);
  });

  it("keeps explicit Sort now in the background while a second capture is durably accepted", async () => {
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    const retryReply = deferred<Response>();
    const network = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      const body = JSON.parse(String(init?.body));
      return body.captureId ? new Response(null, { status: 503 }) : retryReply.promise;
    });
    stubSortFetch(network);
    const hook = await mount();
    act(() => hook.result.current.setText("Older pending retry"));
    await act(async () => { await hook.result.current.submit(); });
    const older = hook.result.current.unsorted[0];
    online = true;

    let retry!: Promise<void>;
    act(() => { retry = hook.result.current.resort(older); });
    await waitFor(() => expect(network.mock.calls.filter(([url]) =>
      String(url) === "/api/sort").length).toBe(1));
    expect(hook.result.current.busy).toBeNull();

    act(() => hook.result.current.setText("New capture during explicit retry"));
    await act(async () => { await hook.result.current.submit(); });

    expect(hook.result.current.text).toBe("");
    expect(hook.result.current.busy).toBeNull();
    expect(hook.result.current.unsorted.map((action) => action.text)).toEqual([
      "New capture during explicit retry",
      "Older pending retry",
    ]);
    retryReply.resolve(new Response(null, { status: 503 }));
    await act(async () => { await retry; });
  });

  it("hard-times out stalled Sort now, releases authority, and later succeeds", async () => {
    let online = false;
    let sortStalls = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    const network = vi.fn(async (url: unknown) =>
      String(url) === "/api/sort"
        ? sortStalls
          ? new Promise<Response>(() => {})
          : sortedResponse("Retry releases after deadline")
        : new Response(null, { status: 503 }));
    stubSortFetch(network);
    const hook = await mount();
    act(() => hook.result.current.setText("Retry releases after deadline"));
    await act(async () => { await hook.result.current.submit(); });
    const pending = hook.result.current.unsorted[0];
    online = true;
    vi.useFakeTimers();
    try {
      let first!: Promise<void>;
      act(() => { first = hook.result.current.resort(pending); });
      await act(async () => { await Promise.resolve(); });
      expect(network.mock.calls.filter(([url]) => String(url) === "/api/sort")).toHaveLength(1);
      expect(hook.result.current.busy).toBeNull();

      await act(async () => { await vi.advanceTimersByTimeAsync(55_000); });
      await act(async () => { await first; });
      expect(hook.result.current.busy).toBeNull();
      expect(hook.result.current.err).toBe("Saved here. Sorting is unavailable right now.");
      expect(hook.result.current.unsorted).toEqual([
        expect.objectContaining({ id: pending.id, text: "Retry releases after deadline", unsorted: true }),
      ]);
      expect(hook.result.current.landed).toBeNull();

      vi.useRealTimers();
      sortStalls = false;
      await act(async () => { await hook.result.current.resort(pending); });
      expect(network.mock.calls.filter(([url]) => String(url) === "/api/sort")).toHaveLength(2);
      expect(hook.result.current.unsorted).toHaveLength(0);
      expect(hook.result.current.data.actions.filter((action) =>
        action.text === "Retry releases after deadline" && !action.unsorted
      )).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds stalled image loading, preserves every byte, releases retry state, and later succeeds", async () => {
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    stubSortFetch(vi.fn(async (url: unknown) =>
      String(url) === "/api/sort"
        ? sortedResponse("Image read must share the retry deadline")
        : new Response(null, { status: 503 })));
    const hook = await mount();
    act(() => {
      hook.result.current.setText("Image read must share the retry deadline");
      hook.result.current.setPics([{ id: "deadline-image", src: "data:image/png;base64,deadline" }]);
    });
    await act(async () => { await hook.result.current.submit(); });
    const pending = hook.result.current.unsorted[0];
    const pendingBefore = JSON.stringify(pending);
    const boardBefore = await storage.get(KEY);
    const realGet = storage.get;
    const getSpy = vi.spyOn(storage, "get").mockImplementation((key) =>
      key === IMG("deadline-image") ? new Promise<string | null>(() => {}) : realGet(key));
    online = true;

    vi.useFakeTimers();
    try {
      let released = false;
      act(() => { void hook.result.current.resort(pending).then(() => { released = true; }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(55_000); });
      vi.useRealTimers();
      expect(released).toBe(true);
      expect(hook.result.current.busy).toBeNull();
      expect(JSON.stringify(hook.result.current.unsorted[0])).toBe(pendingBefore);
      expect(await realGet(KEY)).toBe(boardBefore);
      expect(await realGet(IMG("deadline-image"))).toBe("data:image/png;base64,deadline");
      expect(hook.result.current.landed).toBeNull();

      getSpy.mockRestore();
      await act(async () => { await hook.result.current.resort(pending); });
      expect(hook.result.current.unsorted).toHaveLength(0);
      expect(hook.result.current.data.actions).toEqual([
        expect.objectContaining({
          text: "Image read must share the retry deadline",
          shot: expect.objectContaining({ threadId: expect.any(String), fragId: expect.any(String) }),
        }),
      ]);
      expect(hook.result.current.data.threads.flatMap((thread) => thread.frags))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ imgs: ["deadline-image"] }),
        ]));
      expect(await storage.get(IMG("deadline-image"))).toBe("data:image/png;base64,deadline");
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds stalled intention expansion and permits a later successful retry", async () => {
    let online = false;
    let expansionStalls = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    stubSortFetch(vi.fn(async (url: unknown) => {
      if (String(url) === "/api/sort") {
        return sortedResponse("Intention expansion shares the retry deadline", "intention");
      }
      if (String(url) === "/api/intention") {
        return expansionStalls
          ? new Promise<Response>(() => {})
          : Response.json({
              expandedIntention: "I live with bounded retries",
              recommendedActions: [],
              counterIntentions: [],
              via: "synthetic-intention",
            });
      }
      return new Response(null, { status: 503 });
    }));
    const hook = await mount();
    act(() => hook.result.current.setText("Intention expansion shares the retry deadline"));
    await act(async () => { await hook.result.current.submit(); });
    const pending = hook.result.current.unsorted[0];
    const pendingBefore = JSON.stringify(pending);
    online = true;

    vi.useFakeTimers();
    try {
      let released = false;
      act(() => { void hook.result.current.resort(pending).then(() => { released = true; }); });
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(55_000); });
      vi.useRealTimers();

      expect(released).toBe(true);
      expect(hook.result.current.busy).toBeNull();
      expect(hook.result.current.draft).toBeNull();
      expect(JSON.stringify(hook.result.current.unsorted[0])).toBe(pendingBefore);
      expect(hook.result.current.landed).toBeNull();

      expansionStalls = false;
      await act(async () => { await hook.result.current.resort(pending); });
      expect(hook.result.current.draft).toMatchObject({
        rawInput: "Intention expansion shares the retry deadline",
        expandedIntention: "I live with bounded retries",
      });
      expect(JSON.stringify(hook.result.current.unsorted[0])).toBe(pendingBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets an automatic commit that claimed finalization finish truthfully after the timeout lands", async () => {
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    stubSortFetch(vi.fn(async (url: unknown) =>
      String(url) === "/api/sort"
        ? sortedResponse("Persistence owns its claimed commit phase")
        : new Response(null, { status: 503 })));
    const hook = await mount();
    act(() => hook.result.current.setText("Persistence owns its claimed commit phase"));
    await act(async () => { await hook.result.current.submit(); });
    const pending = hook.result.current.unsorted[0];
    const persistence = deferred<void>();
    const persistenceStarted = deferred<void>();
    const realSetMany = storage.setMany;
    vi.spyOn(storage, "setMany").mockImplementationOnce(async (entries, guard) => {
      persistenceStarted.resolve();
      await persistence.promise;
      return realSetMany(entries, guard);
    });
    online = true;

    vi.useFakeTimers();
    try {
      let released = false;
      let retry!: Promise<void>;
      act(() => {
        retry = hook.result.current.resort(pending).then(() => { released = true; });
      });
      await persistenceStarted.promise;
      await vi.advanceTimersByTimeAsync(55_000);
      await Promise.resolve();
      expect(released).toBe(false);
      vi.useRealTimers();

      await act(async () => {
        persistence.resolve();
        await retry;
      });
      expect(released).toBe(true);
      expect(hook.result.current.finalizingUnsortedIds).toEqual([]);
      expect(hook.result.current.unsorted).toHaveLength(0);
      expect(hook.result.current.data.actions.filter((action) =>
        action.text === "Persistence owns its claimed commit phase" && !action.unsorted
      )).toHaveLength(1);
      const persisted = JSON.parse((await storage.get(KEY))!);
      expect(persisted.actions.some((action: { text: string; unsorted?: boolean }) =>
        action.text === "Persistence owns its claimed commit phase" && !action.unsorted
      )).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates and later renames an offline Thread without provider work", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const network = vi.fn();
    stubSortFetch(network);
    const hook = await mount();
    act(() => hook.result.current.setText("Plan the Capture release without asking a model"));
    await act(async () => { await hook.result.current.submit(); });

    const pending = hook.result.current.unsorted[0];
    await act(async () => {
      await hook.result.current.manualSort(pending, { kind: "thread", threadId: null });
    });
    const temporary = hook.result.current.data.threads.find((thread) => thread.temporaryName)!;
    expect(temporary.name).toBe("Temporary — Plan the Capture release without");
    expect(temporary.frags[0]).toMatchObject({
      text: "Plan the Capture release without asking a model",
    });
    expect(network.mock.calls.filter(([url]) =>
      ["/api/sort", "/api/intention", "/api/summarize"].includes(String(url))
    )).toHaveLength(0);

    await act(async () => { await hook.result.current.renameThread(temporary.id, "Release planning"); });
    const renamed = hook.result.current.data.threads.find((thread) => thread.id === temporary.id)!;
    expect(renamed.name).toBe("Release planning");
    expect(renamed).not.toHaveProperty("temporaryName");
    expect(hook.result.current.data.corrections).toEqual([]);
  });

  it("survives reload during inference with raw text, transcript, image, destination, captureId and revision", async () => {
    const waiting = deferred<Response>();
    stubSortFetch(vi.fn((url: unknown) =>
      String(url) === "/api/sort"
        ? waiting.promise
        : Promise.resolve(new Response(null, { status: 503 }))));
    const hook = await mount();
    act(() => {
      hook.result.current.setOpen("destination");
      hook.result.current.setText("Reload-safe source");
      hook.result.current.setTranscript("Reload safe, um, source");
      hook.result.current.setPics([{ id: "photo-reload", src: "data:image/png;base64,reload" }]);
    });
    await act(async () => { await hook.result.current.submit(true); });
    hook.unmount();

    const reopened = await mount();
    expect(reopened.result.current.unsorted).toEqual([
      expect.objectContaining({
        text: "Reload-safe source",
        src: "Reload-safe source",
        imgs: ["photo-reload"],
        threadId: "destination",
        pendingRevision: 1,
      }),
    ]);
    const pending = reopened.result.current.data.ledger.find((entry) => entry.kind === "pending" && !entry.undone)!;
    expect(pending).toMatchObject({
      raw: "Reload-safe source",
      transcript: "Reload safe, um, source",
      imgs: ["photo-reload"],
      openThreadId: "destination",
      pendingRevision: 1,
    });
    expect(pending.captureId).toEqual(expect.any(String));
    expect(await storage.get(IMG("photo-reload"))).toBe("data:image/png;base64,reload");
  });

  it("reload discovers one finite oldest-first recovery batch without blocking the app", async () => {
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    const network = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      const body = JSON.parse(String(init?.body));
      return responseFor(body.captureId, body.raw);
    });
    stubSortFetch(network);
    const hook = await mount();
    for (const source of ["Pending one", "Pending two", "Pending three", "Pending four"]) {
      act(() => hook.result.current.setText(source));
      await act(async () => { await hook.result.current.submit(); });
    }
    expect(hook.result.current.unsorted.map((item) => item.text)).toEqual([
      "Pending four", "Pending three", "Pending two", "Pending one",
    ]);
    hook.unmount();
    const records = parsePendingRecoveryRecords(await storage.get(PENDING_RECOVERY_KEY));
    await storage.set(PENDING_RECOVERY_KEY, JSON.stringify(records.map((record) => ({
      ...record,
      nextAttemptAt: 0,
    }))));
    online = true;

    const reopened = await mount();
    act(() => {
      reopened.result.current.setText("Composer remains usable during recovery");
      reopened.result.current.setTab("threads");
      reopened.result.current.setShowSettings(true);
    });

    await waitFor(() => expect(network.mock.calls.filter(([url]) =>
      String(url) === "/api/sort")).toHaveLength(3));
    await waitFor(() => expect(reopened.result.current.unsorted).toHaveLength(1));
    expect(reopened.result.current.unsorted[0].text).toBe("Pending four");
    expect(reopened.result.current.text).toBe("Composer remains usable during recovery");
    expect(reopened.result.current.tab).toBe("threads");
    expect(reopened.result.current.showSettings).toBe(true);
    expect(reopened.result.current.busy).toBeNull();
  });

  it("reload recovery loads and sends every offline image byte in order before settlement", async () => {
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    let sortBody: { imgs?: string[] } | undefined;
    stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      sortBody = JSON.parse(String(init?.body));
      return sortedResponse("Offline image recovery");
    }));
    const hook = await mount();
    act(() => {
      hook.result.current.setText("Offline image recovery");
      hook.result.current.setPics([
        { id: "offline-image-one", src: "data:image/png;base64,one" },
        { id: "offline-image-two", src: "data:image/png;base64,two" },
      ]);
    });
    await act(async () => { await hook.result.current.submit(); });
    hook.unmount();
    const records = parsePendingRecoveryRecords(await storage.get(PENDING_RECOVERY_KEY));
    await storage.set(PENDING_RECOVERY_KEY, JSON.stringify(records.map((record) => ({
      ...record,
      nextAttemptAt: 0,
    }))));
    online = true;

    const reopened = await mount();
    await waitFor(() => expect(reopened.result.current.unsorted).toHaveLength(0));
    expect(sortBody?.imgs).toEqual([
      "data:image/png;base64,one",
      "data:image/png;base64,two",
    ]);
    expect(reopened.result.current.data.actions.filter((action) =>
      action.text === "Offline image recovery" && !action.unsorted
    )).toHaveLength(1);
    expect(await storage.get(IMG("offline-image-one"))).toBe("data:image/png;base64,one");
    expect(await storage.get(IMG("offline-image-two"))).toBe("data:image/png;base64,two");
  });

  it("never loops after malformed immediate and recovery responses exhaust the durable limit", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    let malformed = true;
    const network = vi.fn(async (url: unknown) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      return malformed
        ? Response.json({ planned: true, captureId: "wrong", recovery: {} })
        : sortedResponse("Malformed responses stay bounded");
    });
    stubSortFetch(network);
    const hook = await mount();
    act(() => hook.result.current.setText("Malformed responses stay bounded"));
    await act(async () => { await hook.result.current.submit(); });
    await waitFor(() => expect(hook.result.current.landed)
      .toBe("Saved. Awaiting sorting or placement"));
    expect(hook.result.current.err).toBe("");
    hook.unmount();
    let records = parsePendingRecoveryRecords(await storage.get(PENDING_RECOVERY_KEY));
    await storage.set(PENDING_RECOVERY_KEY, JSON.stringify(records.map((record) => ({
      ...record,
      nextAttemptAt: 0,
    }))));

    const recovered = await mount();
    await waitFor(() => expect(network.mock.calls.filter(([url]) =>
      String(url) === "/api/sort")).toHaveLength(4));
    await waitFor(async () => {
      records = parsePendingRecoveryRecords(await storage.get(PENDING_RECOVERY_KEY));
      expect(records[0]?.automaticAttempts).toBe(2);
    });
    expect(recovered.result.current.unsorted).toEqual([
      expect.objectContaining({ text: "Malformed responses stay bounded", unsorted: true }),
    ]);
    recovered.unmount();

    const third = await mount();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(network.mock.calls.filter(([url]) => String(url) === "/api/sort")).toHaveLength(4);
    expect(third.result.current.unsorted).toHaveLength(1);
    expect(third.result.current.busy).toBeNull();

    malformed = false;
    await act(async () => { await third.result.current.resort(third.result.current.unsorted[0]); });
    expect(network.mock.calls.filter(([url]) => String(url) === "/api/sort")).toHaveLength(5);
    expect(third.result.current.unsorted).toHaveLength(0);
    expect(third.result.current.data.actions.filter((action) =>
      action.text === "Malformed responses stay bounded" && !action.unsorted
    )).toHaveLength(1);
  });

  it("manual filing after restarted recovery begins defeats its delayed response", async () => {
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    const delayed = deferred<Response>();
    let captureId = "";
    stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      captureId = JSON.parse(String(init?.body)).captureId;
      return delayed.promise;
    }));
    const hook = await mount();
    act(() => hook.result.current.setText("Manual wins after restart"));
    await act(async () => { await hook.result.current.submit(); });
    hook.unmount();
    const records = parsePendingRecoveryRecords(await storage.get(PENDING_RECOVERY_KEY));
    await storage.set(PENDING_RECOVERY_KEY, JSON.stringify(records.map((record) => ({
      ...record,
      nextAttemptAt: 0,
    }))));
    online = true;

    const reopened = await mount();
    await waitFor(() => expect(captureId).not.toBe(""));
    const shown = reopened.result.current.unsorted[0];
    let manualResult: unknown;
    await act(async () => {
      manualResult = await reopened.result.current.manualSort(shown, { kind: "action" });
    });
    await act(async () => {
      delayed.resolve(responseFor(captureId, "Manual wins after restart"));
      await Promise.resolve();
    });

    expect(manualResult).toBe(true);
    expect(reopened.result.current.unsorted).toHaveLength(0);
    expect(reopened.result.current.data.actions.filter((action) =>
      action.text === "Manual wins after restart" && !action.unsorted
    )).toHaveLength(1);
    expect(reopened.result.current.data.ledger.filter((entry) =>
      (entry.captureId ?? entry.id) === captureId && entry.kind !== "pending" && !entry.undone
    )).toEqual([expect.objectContaining({ settledBy: "manual" })]);
  });

  it("settles a validated result once against the latest board and ignores an edited delayed response", async () => {
    const first = deferred<Response>();
    let requestCaptureId = "";
    const network = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      const request = JSON.parse(String(init?.body));
      requestCaptureId = request.captureId;
      return first.promise;
    });
    stubSortFetch(network);
    const hook = await mount();
    act(() => hook.result.current.setText("Settle only this revision"));
    await act(async () => { await hook.result.current.submit(); });
    const pending = hook.result.current.unsorted[0];
    await act(async () => { await hook.result.current.editUnsorted(pending.id, "A later edit wins"); });

    await act(async () => { first.resolve(responseFor(requestCaptureId, "Settle only this revision")); });
    await waitFor(() => expect(hook.result.current.unsorted[0]?.text).toBe("A later edit wins"));
    expect(hook.result.current.data.actions.filter((item) => !item.unsorted)).toHaveLength(0);
    expect(hook.result.current.data.ledger.filter((entry) =>
      entry.captureId === requestCaptureId && entry.kind !== "pending" && !entry.undone
    )).toHaveLength(0);
  });

  it("ignores a delayed response after the exact pending envelope is deleted", async () => {
    const delayed = deferred<Response>();
    let captureId = "";
    stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      const request = JSON.parse(String(init?.body));
      captureId = request.captureId;
      return delayed.promise;
    }));
    const hook = await mount();
    act(() => hook.result.current.setText("Delete defeats the delayed model"));
    await act(async () => { await hook.result.current.submit(); });
    await act(async () => { await hook.result.current.removeUnsorted(hook.result.current.unsorted[0]); });
    await act(async () => {
      delayed.resolve(responseFor(captureId, "Delete defeats the delayed model"));
    });

    await waitFor(() => expect(hook.result.current.unsorted).toHaveLength(0));
    expect(hook.result.current.data.actions).toHaveLength(0);
    expect(hook.result.current.data.ledger.filter((entry) =>
      entry.captureId === captureId && entry.kind !== "pending" && !entry.undone
    )).toHaveLength(0);
  });

  it("lets a manual durable transaction beat a background settlement that resolves while the write waits", async () => {
    const delayedModel = deferred<Response>();
    let captureId = "";
    stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      captureId = JSON.parse(String(init?.body)).captureId;
      return delayedModel.promise;
    }));
    const hook = await mount();
    act(() => hook.result.current.setText("Manual wins during its own commit"));
    await act(async () => { await hook.result.current.submit(); });
    const pending = hook.result.current.unsorted[0];

    const delayedWrite = deferred<void>();
    const writeStarted = deferred<void>();
    const realSetMany = storage.setMany;
    vi.spyOn(storage, "setMany").mockImplementationOnce(async (entries) => {
      writeStarted.resolve();
      await delayedWrite.promise;
      return realSetMany(entries);
    });
    let manual!: Promise<unknown>;
    act(() => { manual = hook.result.current.manualSort(pending, { kind: "action" }); });
    await writeStarted.promise;

    delayedModel.resolve(responseFor(captureId, "Manual wins during its own commit"));
    await Promise.resolve();
    expect(hook.result.current.unsorted).toEqual([
      expect.objectContaining({ id: pending.id, text: "Manual wins during its own commit" }),
    ]);

    let manualResult: unknown;
    await act(async () => {
      delayedWrite.resolve();
      manualResult = await manual;
    });
    expect(manualResult).toBe(true);
    expect(hook.result.current.data.actions.filter((action) =>
      action.text === "Manual wins during its own commit")).toHaveLength(1);
    expect(hook.result.current.data.ledger.filter((entry) =>
      entry.captureId === captureId && entry.kind !== "pending" && !entry.undone
    )).toEqual([expect.objectContaining({ settledBy: "manual" })]);
  });

  it("refuses a manual claim once planned settlement has entered atomic finalization", async () => {
    const delayedModel = deferred<Response>();
    let captureId = "";
    stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      captureId = JSON.parse(String(init?.body)).captureId;
      return delayedModel.promise;
    }));
    const hook = await mount();
    const persistence = deferred<void>();
    const persistenceStarted = deferred<void>();
    const realSetMany = storage.setMany;
    let delayed = false;
    vi.spyOn(storage, "setMany").mockImplementation(async (entries, guard) => {
      const raw = entries.find(([key]) => key === KEY)?.[1];
      const board = raw ? JSON.parse(raw) : null;
      const automatic = board?.ledger?.some((entry: { settledBy?: string }) =>
        entry.settledBy === "automatic");
      if (automatic && !delayed) {
        delayed = true;
        // Let IndexedDB commit first, then hold the acknowledgement. A manual
        // click in this window must not revoke a fact already on disk.
        await realSetMany(entries, guard);
        persistenceStarted.resolve();
        await persistence.promise;
        return;
      }
      if (guard?.signal?.aborted || guard?.current?.() === false) {
        throw new DOMException("authority revoked", "AbortError");
      }
      return realSetMany(entries, guard);
    });
    act(() => hook.result.current.setText("Manual defeats prepared planned settlement"));
    await act(async () => { await hook.result.current.submit(); });
    delayedModel.resolve(responseFor(captureId, "Manual defeats prepared planned settlement"));
    await persistenceStarted.promise;
    const pending = hook.result.current.unsorted[0];

    let manualResult: unknown;
    let manual!: Promise<void>;
    act(() => {
      manual = hook.result.current.manualSort(pending, { kind: "action" })
        .then((result) => { manualResult = result; });
    });
    await Promise.resolve();
    await act(async () => {
      persistence.resolve();
      await manual;
    });

    expect(manualResult).toBe(false);
    await waitFor(() => expect(hook.result.current.unsorted).toHaveLength(0));
    expect(hook.result.current.data.actions.filter((action) =>
      action.text === "Manual defeats prepared planned settlement" && !action.unsorted
    )).toHaveLength(1);
    expect(hook.result.current.data.ledger.filter((entry) =>
      entry.captureId === captureId && entry.kind !== "pending" && !entry.undone
    )).toEqual([expect.objectContaining({ settledBy: "automatic" })]);
    const persisted = JSON.parse((await storage.get(KEY))!);
    expect(persisted.ledger.filter((entry: { captureId?: string; kind: string; undone?: boolean }) =>
      entry.captureId === captureId && entry.kind !== "pending" && !entry.undone
    )).toEqual([expect.objectContaining({ settledBy: "automatic" })]);

    hook.unmount();
    const reloaded = await mount();
    expect(reloaded.result.current.unsorted).toHaveLength(0);
    expect(reloaded.result.current.data.ledger.filter((entry) =>
      entry.captureId === captureId && entry.kind !== "pending" && !entry.undone
    )).toEqual([expect.objectContaining({ settledBy: "automatic" })]);
  });

  it("refuses a manual claim once explicit retry settlement has entered atomic finalization", async () => {
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    stubSortFetch(vi.fn(async (url: unknown) =>
      String(url) === "/api/sort"
        ? sortedResponse("Manual defeats prepared explicit retry")
        : new Response(null, { status: 503 })));
    const hook = await mount();
    act(() => hook.result.current.setText("Manual defeats prepared explicit retry"));
    await act(async () => { await hook.result.current.submit(); });
    const pending = hook.result.current.unsorted[0];
    const pendingRow = hook.result.current.data.ledger.find((entry) =>
      entry.kind === "pending" && !entry.undone && entry.targetId === pending.id)!;
    const captureId = pendingRow.captureId ?? pendingRow.id;
    const persistence = deferred<void>();
    const persistenceStarted = deferred<void>();
    const realSetMany = storage.setMany;
    vi.spyOn(storage, "setMany").mockImplementationOnce(async (entries, guard) => {
      persistenceStarted.resolve();
      await persistence.promise;
      if (guard?.signal?.aborted || guard?.current?.() === false) {
        throw new DOMException("authority revoked", "AbortError");
      }
      return realSetMany(entries, guard);
    });
    online = true;

    let retry!: Promise<void>;
    act(() => { retry = hook.result.current.resort(pending); });
    await persistenceStarted.promise;
    let manualResult: unknown;
    let manual!: Promise<void>;
    act(() => {
      manual = hook.result.current.manualSort(pending, { kind: "action" })
        .then((result) => { manualResult = result; });
    });
    await Promise.resolve();
    await act(async () => {
      persistence.resolve();
      await retry;
      await manual;
    });

    expect(manualResult).toBe(false);
    expect(hook.result.current.unsorted).toHaveLength(0);
    expect(hook.result.current.data.actions.filter((action) =>
      action.text === "Manual defeats prepared explicit retry" && !action.unsorted
    )).toHaveLength(1);
    const explicitSettlements = hook.result.current.data.ledger.filter((entry) =>
      (entry.captureId ?? entry.id) === captureId && entry.kind !== "pending" && !entry.undone
    );
    expect(explicitSettlements).toHaveLength(1);
    expect(explicitSettlements[0].settledBy).not.toBe("manual");
  });

  it("does not show a Sort now receipt, switch tabs, or arm a new Undo when settlement persistence fails", async () => {
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    stubSortFetch(vi.fn(async (url: unknown) =>
      String(url) === "/api/sort"
        ? Response.json({
            clean: "Retry remains pending",
            kind: "action",
            title: "Retry remains pending",
            actions: ["Retry remains pending"],
            shelfLife: "keep",
            due: null,
            threadId: null,
            threadName: null,
            primaryText: null,
            also: [],
          })
        : new Response(null, { status: 503 })));
    const hook = await mount();
    act(() => hook.result.current.setText("Retry remains pending"));
    await act(async () => { await hook.result.current.submit(); });
    const pending = hook.result.current.unsorted[0];
    const before = JSON.stringify(hook.result.current.data);
    act(() => hook.result.current.setTab("threads"));
    online = true;
    vi.spyOn(storage, "setMany").mockRejectedValueOnce(new DOMException("quota", "QuotaExceededError"));

    await act(async () => { await hook.result.current.resort(pending); });

    expect(JSON.stringify(hook.result.current.data)).toBe(before);
    expect(hook.result.current.unsorted).toEqual([
      expect.objectContaining({ id: pending.id, text: "Retry remains pending", unsorted: true }),
    ]);
    expect(hook.result.current.tab).toBe("threads");
    expect(hook.result.current.landed).toBeNull();
    expect(hook.result.current.landedIds).toEqual([]);
  });

  it("lets manual filing abort and defeat an in-flight explicit Sort now request", async () => {
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    const delayed = deferred<Response>();
    let sortSignal: AbortSignal | undefined;
    const network = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      sortSignal = init?.signal ?? undefined;
      return delayed.promise;
    });
    stubSortFetch(network);
    const hook = await mount();
    act(() => hook.result.current.setText("Manual wins over explicit retry"));
    await act(async () => { await hook.result.current.submit(); });
    const pending = hook.result.current.unsorted[0];
    online = true;

    let retry!: Promise<void>;
    act(() => { retry = hook.result.current.resort(pending); });
    await waitFor(() => expect(network.mock.calls.some(([url]) => String(url) === "/api/sort")).toBe(true));
    expect(hook.result.current.busy).toBeNull();
    let manualResult: unknown;
    await act(async () => {
      manualResult = await hook.result.current.manualSort(pending, { kind: "action" });
    });
    const wasAborted = sortSignal?.aborted;
    await act(async () => {
      delayed.resolve(Response.json({
        clean: pending.text,
        kind: "action",
        title: pending.text,
        actions: [pending.text],
        shelfLife: "keep",
        due: null,
        threadId: null,
        threadName: null,
        primaryText: null,
        also: [],
      }));
      await retry;
    });

    expect(sortSignal).toBeDefined();
    expect(wasAborted).toBe(true);
    expect(manualResult).toBe(true);
    expect(hook.result.current.busy).toBeNull();
    expect(hook.result.current.data.actions.filter((action) =>
      action.text === "Manual wins over explicit retry" && !action.unsorted
    )).toHaveLength(1);
  });

  it("commits a lossless manual split once, keeps images on the original envelope, and reloads identically", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    stubSortFetch(vi.fn());
    const hook = await mount();
    act(() => {
      hook.result.current.setText("First half. Second half.");
      hook.result.current.setTranscript("First half, second half");
      hook.result.current.setPics([{ id: "split-photo", src: "data:image/png;base64,split" }]);
    });
    await act(async () => { await hook.result.current.submit(true); });
    const pending = hook.result.current.unsorted[0];
    const pendingSnapshot = snapshotManualPending(hook.result.current.data.ledger, pending)!;
    const write = vi.spyOn(storage, "setMany");

    let applied: unknown;
    await act(async () => {
      applied = await hook.result.current.manualSplit(pending, [
        { id: "second", sourceOrder: 1, text: "Second half.", destination: { kind: "pending" } },
        { id: "first", sourceOrder: 0, text: "First half. ", destination: { kind: "action" } },
      ], pendingSnapshot);
    });

    expect(applied).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(hook.result.current.data.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "First half. ", src: "First half. ", imgs: [] }),
      expect.objectContaining({ text: "Second half.", src: "Second half.", unsorted: true, imgs: [] }),
      expect.objectContaining({ id: pending.id, text: "", src: "", unsorted: true, imgs: ["split-photo"] }),
    ]));
    expect(hook.result.current.data.actions.find((action) => action.text === "First half. ")?.unsorted)
      .not.toBe(true);
    const captureId = hook.result.current.data.ledger.find((entry) =>
      entry.targetId === pending.id && !entry.undone)?.captureId;
    expect(captureId).toEqual(expect.any(String));
    expect(hook.result.current.data.ledger.filter((entry) =>
      entry.captureId === captureId && !entry.undone
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ clean: "First half. ", settledBy: "manual", transcript: "First half, second half" }),
      expect.objectContaining({ clean: "Second half.", kind: "pending", partial: true }),
      expect.objectContaining({ clean: "", kind: "pending", imgs: ["split-photo"] }),
    ]));
    const beforeReload = hook.result.current.data;
    hook.unmount();
    const reopened = await mount();
    expect(reopened.result.current.data).toEqual(beforeReload);
    expect(await storage.get(IMG("split-photo"))).toBe("data:image/png;base64,split");
  });

  it("keeps the exact original pending state when split persistence fails and permits an identical retry", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    stubSortFetch(vi.fn());
    const hook = await mount();
    act(() => hook.result.current.setText("One.Two."));
    await act(async () => { await hook.result.current.submit(); });
    const pending = hook.result.current.unsorted[0];
    const pendingSnapshot = snapshotManualPending(hook.result.current.data.ledger, pending)!;
    const before = JSON.stringify(hook.result.current.data);
    const draft = [
      { id: "one", sourceOrder: 0, text: "One.", destination: { kind: "action" } as const },
      { id: "two", sourceOrder: 1, text: "Two.", destination: { kind: "intention" } as const },
    ];
    vi.spyOn(storage, "setMany").mockRejectedValueOnce(new DOMException("quota", "QuotaExceededError"));

    let failed: unknown;
    await act(async () => { failed = await hook.result.current.manualSplit(pending, draft, pendingSnapshot); });
    expect(failed).toBe(false);
    expect(JSON.stringify(hook.result.current.data)).toBe(before);
    expect(hook.result.current.unsorted).toEqual([expect.objectContaining({
      id: pending.id, text: "One.Two.", pendingRevision: 1,
    })]);

    let retried: unknown;
    await act(async () => { retried = await hook.result.current.manualSplit(pending, draft, pendingSnapshot); });
    expect(retried).toBe(true);
    expect(hook.result.current.data.actions.filter((action) => !action.unsorted)).toHaveLength(1);
    expect(hook.result.current.data.intentions).toHaveLength(1);
  });

  it("lets manual split abort and permanently defeat an in-flight automatic result", async () => {
    const delayed = deferred<Response>();
    let captureId = "";
    let sortSignal: AbortSignal | undefined;
    stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      const request = JSON.parse(String(init?.body));
      captureId = request.captureId;
      sortSignal = init?.signal ?? undefined;
      return delayed.promise;
    }));
    const hook = await mount();
    act(() => hook.result.current.setText("Manual. Split wins."));
    await act(async () => { await hook.result.current.submit(); });
    const pending = hook.result.current.unsorted[0];
    const pendingSnapshot = snapshotManualPending(hook.result.current.data.ledger, pending)!;

    let applied: unknown;
    await act(async () => {
      applied = await hook.result.current.manualSplit(pending, [
        { id: "one", sourceOrder: 0, text: "Manual. ", destination: { kind: "action" } },
        { id: "two", sourceOrder: 1, text: "Split wins.", destination: { kind: "pending" } },
      ], pendingSnapshot);
    });
    const aborted = sortSignal?.aborted;
    await act(async () => {
      delayed.resolve(responseFor(captureId, "Manual. Split wins."));
      await Promise.resolve();
    });

    expect(applied).toBe(true);
    expect(aborted).toBe(true);
    expect(hook.result.current.data.ledger.filter((entry) =>
      entry.captureId === captureId && entry.settledBy === "automatic" && !entry.undone
    )).toHaveLength(0);
    expect(hook.result.current.data.actions.filter((action) => action.text === "Manual. ")).toHaveLength(1);
    expect(hook.result.current.unsorted).toEqual([
      expect.objectContaining({ text: "Split wins.", unsorted: true }),
    ]);
  });

  it("keeps the exact pending state after a failed manual commit and releases its claim for retry", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    stubSortFetch(vi.fn());
    const hook = await mount();
    act(() => {
      hook.result.current.setText("Pending survives a failed manual choice");
      hook.result.current.setPics([{ id: "manual-failure-photo", src: "data:image/png;base64,failure" }]);
    });
    await act(async () => { await hook.result.current.submit(); });
    const pending = hook.result.current.unsorted[0];
    const before = JSON.stringify(hook.result.current.data);
    const persistedBefore = await storage.get(KEY);

    vi.spyOn(storage, "setMany").mockRejectedValueOnce(new DOMException("quota", "QuotaExceededError"));
    let failed: unknown;
    await act(async () => {
      failed = await hook.result.current.manualSort(pending, { kind: "action" });
    });
    expect(failed).toBe(false);
    expect(JSON.stringify(hook.result.current.data)).toBe(before);
    expect(await storage.get(KEY)).toBe(persistedBefore);
    expect(hook.result.current.unsorted).toEqual([
      expect.objectContaining({
        id: pending.id,
        text: "Pending survives a failed manual choice",
        imgs: ["manual-failure-photo"],
        pendingRevision: 1,
      }),
    ]);

    let retried: unknown;
    await act(async () => {
      retried = await hook.result.current.manualSort(pending, { kind: "action" });
    });
    expect(retried).toBe(true);
    expect(hook.result.current.unsorted).toHaveLength(0);
  });

  it("keeps a single Tidy proposal visible and non-undoable when its commit fails", async () => {
    const now = Date.now();
    await storage.set(KEY, JSON.stringify({
      ...EMPTY,
      principles: [],
      actions: [{
        id: "stale-one", text: "Old open action", done: false, at: now - 60 * 24 * 60 * 60 * 1000,
        updatedAt: now - 60 * 24 * 60 * 60 * 1000, shelf: "keep", expires: null,
      }],
    }));
    stubSortFetch(vi.fn(async () => new Response(null, { status: 503 })));
    const hook = await mount();
    await act(async () => { await hook.result.current.runOrganize(); });
    const proposal = hook.result.current.organize?.find((item) => item.kind === "let_go");
    expect(proposal).toBeTruthy();
    vi.spyOn(storage, "setMany").mockRejectedValueOnce(new DOMException("quota", "QuotaExceededError"));

    let accepted: unknown;
    await act(async () => { accepted = await hook.result.current.acceptOrganize(proposal!.id); });

    expect(accepted).toBe(false);
    expect(hook.result.current.data.actions[0]).toMatchObject({ id: "stale-one" });
    expect(hook.result.current.data.actions[0].faded).not.toBe(true);
    expect(hook.result.current.organize?.some((item) => item.id === proposal!.id)).toBe(true);
    expect(hook.result.current.notice).toBeNull();
    expect(hook.result.current.canUndo).toBe(false);
  });

  it("keeps every failed Approve all Tidy row visible and creates no false Undo", async () => {
    const now = Date.now();
    await storage.set(KEY, JSON.stringify({
      ...EMPTY,
      principles: [],
      actions: ["one", "two"].map((id, index) => ({
        id: `stale-${id}`, text: `Old action ${id}`, done: false,
        at: now - (60 + index) * 24 * 60 * 60 * 1000,
        updatedAt: now - (60 + index) * 24 * 60 * 60 * 1000,
        shelf: "keep", expires: null,
      })),
    }));
    stubSortFetch(vi.fn(async () => new Response(null, { status: 503 })));
    const hook = await mount();
    await act(async () => { await hook.result.current.runOrganize(); });
    expect(hook.result.current.organize?.filter((item) => item.kind === "let_go")).toHaveLength(2);
    vi.spyOn(storage, "setMany").mockRejectedValue(new DOMException("quota", "QuotaExceededError"));

    await act(async () => { await hook.result.current.acceptOrganizeAll(); });

    expect(hook.result.current.data.actions.every((action) => !action.faded)).toBe(true);
    expect(hook.result.current.organize?.filter((item) => item.kind === "let_go")).toHaveLength(2);
    expect(hook.result.current.notice).toBeNull();
    expect(hook.result.current.canUndo).toBe(false);
  });

  it("retains an image-backed Action and its bytes when completion persistence fails", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    stubSortFetch(vi.fn());
    const hook = await mount();
    act(() => {
      hook.result.current.setText("Image-backed action must survive");
      hook.result.current.setPics([{ id: "toggle-failure-photo", src: "data:image/png;base64,toggle" }]);
    });
    await act(async () => { await hook.result.current.submit(); });
    await act(async () => {
      await hook.result.current.manualSort(hook.result.current.unsorted[0], { kind: "action" });
    });
    const action = hook.result.current.data.actions[0];
    const persistedBefore = await storage.get(KEY);

    vi.spyOn(storage, "setMany").mockRejectedValueOnce(new DOMException("quota", "QuotaExceededError"));
    await act(async () => { await hook.result.current.toggleAction(action.id); });

    expect(hook.result.current.data.actions).toEqual([
      expect.objectContaining({
        id: action.id,
        imgs: [],
        shot: expect.objectContaining({
          threadId: expect.any(String),
          fragId: expect.any(String),
        }),
      }),
    ]);
    const owner = hook.result.current.data.threads.find((thread) =>
      thread.id === action.shot?.threadId
    );
    expect(owner?.frags.find((frag) => frag.id === action.shot?.fragId)?.imgs)
      .toEqual(["toggle-failure-photo"]);
    expect(await storage.get(KEY)).toBe(persistedBefore);
    expect(await storage.get(IMG("toggle-failure-photo"))).toBe("data:image/png;base64,toggle");

    await act(async () => { await hook.result.current.toggleAction(action.id); });
    expect(hook.result.current.data.actions).toHaveLength(0);
    expect(hook.result.current.data.completions).toEqual([
      expect.objectContaining({ id: action.id, text: "Image-backed action must survive" }),
    ]);
    expect(hook.result.current.data.threads.find((thread) => thread.id === owner?.id)?.frags[0].imgs)
      .toEqual(["toggle-failure-photo"]);
    expect(await storage.get(IMG("toggle-failure-photo"))).toBe("data:image/png;base64,toggle");

    hook.unmount();
    const reloaded = await mount();
    expect(reloaded.result.current.data.actions).toHaveLength(0);
    expect(reloaded.result.current.data.threads.find((thread) => thread.id === owner?.id)?.frags[0].imgs)
      .toEqual(["toggle-failure-photo"]);
    expect(await storage.get(IMG("toggle-failure-photo"))).toBe("data:image/png;base64,toggle");
  });

  it("serializes Undo behind a delayed manual settlement and persists the Undo result last", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    stubSortFetch(vi.fn());
    const hook = await mount();
    act(() => hook.result.current.setText("Undo this capture while filing waits"));
    await act(async () => { await hook.result.current.submit(); });
    const pending = hook.result.current.unsorted[0];

    const delayedManualWrite = deferred<void>();
    const writeStarted = deferred<void>();
    const realSetMany = storage.setMany;
    vi.spyOn(storage, "setMany").mockImplementationOnce(async (entries) => {
      writeStarted.resolve();
      await delayedManualWrite.promise;
      return realSetMany(entries);
    });

    let manual!: Promise<unknown>;
    act(() => { manual = hook.result.current.manualSort(pending, { kind: "action" }); });
    await writeStarted.promise;
    let undone!: Promise<unknown>;
    act(() => { undone = hook.result.current.undo(); });
    await Promise.resolve();

    await act(async () => {
      delayedManualWrite.resolve();
      await manual;
      await undone;
    });

    expect(hook.result.current.data.actions).toHaveLength(0);
    expect(hook.result.current.text).toBe("Undo this capture while filing waits");
    expect(JSON.parse((await storage.get(KEY))!).actions).toHaveLength(0);
  });

  it("serializes a sync pull behind a delayed manual write without losing either result", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    let remoteAvailable = false;
    const pullResponded = deferred<void>();
    stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
      if (!String(url).startsWith("/api/sync")) return new Response(null, { status: 503 });
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        return Response.json({ ...body, rev: 2 });
      }
      if (!remoteAvailable) return new Response(null, { status: 503 });
      pullResponded.resolve();
      return Response.json({
        board: {
          ...EMPTY,
          principles: [],
          threads: [{
            id: "remote-unrelated",
            name: "Remote unrelated Thread",
            summary: "",
            frags: [],
            updatedAt: Date.now() + 10_000,
          }],
        },
        tombstones: [],
        rev: 1,
      });
    }));
    const hook = await mount();
    act(() => hook.result.current.setText("Manual and remote must both survive"));
    await act(async () => { await hook.result.current.submit(); });
    const pending = hook.result.current.unsorted[0];

    const delayedManualWrite = deferred<void>();
    const writeStarted = deferred<void>();
    const realSetMany = storage.setMany;
    vi.spyOn(storage, "setMany").mockImplementationOnce(async (entries) => {
      writeStarted.resolve();
      await delayedManualWrite.promise;
      return realSetMany(entries);
    });
    let manual!: Promise<unknown>;
    act(() => { manual = hook.result.current.manualSort(pending, { kind: "action" }); });
    await writeStarted.promise;

    remoteAvailable = true;
    let syncing!: Promise<unknown>;
    act(() => { syncing = hook.result.current.syncNow(); });
    await pullResponded.promise;
    await Promise.resolve();
    await act(async () => {
      delayedManualWrite.resolve();
      await manual;
      await syncing;
    });

    expect(hook.result.current.data.actions).toEqual([
      expect.objectContaining({ text: "Manual and remote must both survive" }),
    ]);
    expect(hook.result.current.data.actions[0].unsorted).not.toBe(true);
    expect(hook.result.current.data.threads).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "remote-unrelated", name: "Remote unrelated Thread" }),
    ]));
    const persisted = JSON.parse((await storage.get(KEY))!);
    expect(persisted.actions.some((action: { text: string; unsorted?: boolean }) =>
      action.text === "Manual and remote must both survive" && !action.unsorted)).toBe(true);
    expect(persisted.threads.some((thread: { id: string }) => thread.id === "remote-unrelated")).toBe(true);
  });

  it("does not adopt or acknowledge a sync pull when local persistence fails", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    let remoteAvailable = false;
    stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
      if (!String(url).startsWith("/api/sync") || init?.method === "POST") {
        return new Response(null, { status: 503 });
      }
      if (!remoteAvailable) return new Response(null, { status: 503 });
      return Response.json({
        board: {
          ...EMPTY,
          principles: [],
          threads: [{
            id: "remote-not-durable",
            name: "Must not be adopted",
            summary: "",
            frags: [],
            updatedAt: Date.now() + 10_000,
          }],
        },
        tombstones: [],
        rev: 4,
      });
    }));
    const hook = await mount();
    const before = JSON.stringify(hook.result.current.data);
    const persistedBefore = await storage.get(KEY);
    remoteAvailable = true;
    vi.spyOn(storage, "setMany").mockRejectedValueOnce(new DOMException("quota", "QuotaExceededError"));

    await act(async () => { await hook.result.current.syncNow(); });

    expect(JSON.stringify(hook.result.current.data)).toBe(before);
    expect(await storage.get(KEY)).toBe(persistedBefore);
    expect(hook.result.current.sync?.ok).toBe(false);
  });

  it("rebases an unrelated generic mutation queued behind manual settlement", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    stubSortFetch(vi.fn());
    const hook = await mount();
    act(() => hook.result.current.setText("Older capture is filed manually"));
    await act(async () => { await hook.result.current.submit(); });
    const older = hook.result.current.unsorted[0];
    act(() => hook.result.current.setText("Unrelated pending card changes shelf"));
    await act(async () => { await hook.result.current.submit(); });
    const unrelated = hook.result.current.unsorted.find((action) => action.text === "Unrelated pending card changes shelf")!;

    const delayedManualWrite = deferred<void>();
    const writeStarted = deferred<void>();
    const realSetMany = storage.setMany;
    vi.spyOn(storage, "setMany").mockImplementationOnce(async (entries) => {
      writeStarted.resolve();
      await delayedManualWrite.promise;
      return realSetMany(entries);
    });

    let manual!: Promise<unknown>;
    act(() => { manual = hook.result.current.manualSort(older, { kind: "action" }); });
    await writeStarted.promise;
    let shelf!: Promise<unknown>;
    act(() => { shelf = hook.result.current.setShelf(unrelated.id, 7 * 24 * 60 * 60 * 1000, "days"); });
    await Promise.resolve();

    await act(async () => {
      delayedManualWrite.resolve();
      await manual;
      await shelf;
    });

    expect(hook.result.current.data.actions.find((action) => action.id === unrelated.id))
      .toMatchObject({ text: "Unrelated pending card changes shelf", shelf: "days" });
    expect(hook.result.current.data.actions.find((action) =>
      action.text === "Older capture is filed manually")?.unsorted).not.toBe(true);
    const persisted = JSON.parse((await storage.get(KEY))!);
    expect(persisted.actions.find((action: { id: string }) => action.id === unrelated.id)?.shelf).toBe("days");
    expect(persisted.actions.some((action: { text: string; unsorted?: boolean }) =>
      action.text === "Older capture is filed manually" && !action.unsorted)).toBe(true);
  });

  it("keeps a new durable intake when an older manual commit is delayed", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    stubSortFetch(vi.fn());
    const hook = await mount();
    act(() => hook.result.current.setText("File the older pending capture"));
    await act(async () => { await hook.result.current.submit(); });
    const older = hook.result.current.unsorted[0];

    const delayedManualWrite = deferred<void>();
    const writeStarted = deferred<void>();
    const realSetMany = storage.setMany;
    let writes = 0;
    vi.spyOn(storage, "setMany").mockImplementation(async (entries) => {
      writes += 1;
      if (writes === 1) {
        writeStarted.resolve();
        await delayedManualWrite.promise;
      }
      return realSetMany(entries);
    });

    let manualResult: unknown;
    let manual!: Promise<void>;
    act(() => {
      manual = hook.result.current.manualSort(older, { kind: "action" })
        .then((result) => { manualResult = result; });
    });
    await writeStarted.promise;

    act(() => hook.result.current.setText("New capture while manual persistence waits"));
    let intake!: Promise<unknown>;
    act(() => { intake = hook.result.current.submit(); });
    await Promise.resolve();
    await act(async () => {
      delayedManualWrite.resolve();
      await manual;
      await intake;
    });

    expect(manualResult).toBe(true);
    expect(hook.result.current.data.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "File the older pending capture" }),
      expect.objectContaining({ text: "New capture while manual persistence waits", unsorted: true }),
    ]));
    expect(hook.result.current.data.actions.find((action) =>
      action.text === "File the older pending capture")?.unsorted).not.toBe(true);
    const persisted = JSON.parse((await storage.get(KEY))!);
    expect(persisted.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "File the older pending capture" }),
      expect.objectContaining({ text: "New capture while manual persistence waits", unsorted: true }),
    ]));
    expect(persisted.actions.find((action: { text: string; unsorted?: boolean }) =>
      action.text === "File the older pending capture")?.unsorted).not.toBe(true);
  });

  it("exposes only the exact manual filing Undo beside its receipt and restores it after reload", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    stubSortFetch(vi.fn());
    const hook = await mount();

    act(() => hook.result.current.setText("Older pending card"));
    await act(async () => { await hook.result.current.submit(); });
    const older = hook.result.current.unsorted[0];
    act(() => hook.result.current.setText("Newest pending card owns Undo"));
    await act(async () => { await hook.result.current.submit(); });
    expect(hook.result.current.canUndo).toBe(true);

    await act(async () => {
      await hook.result.current.manualSort(older, { kind: "action" });
    });
    expect(hook.result.current.landed).toBe("Actions");
    expect(hook.result.current.canUndo).toBe(false);
    expect(hook.result.current.canUndoManual).toBe(true);
    expect(hook.result.current.unsorted.map((action) => action.text))
      .toEqual(["Newest pending card owns Undo"]);

    hook.unmount();
    const reopened = await mount();
    expect(reopened.result.current.canUndo).toBe(false);
    expect(reopened.result.current.canUndoManual).toBe(true);
    await act(async () => { await reopened.result.current.undoManual(); });
    expect(reopened.result.current.canUndoManual).toBe(false);
    expect(reopened.result.current.err).toBe("");
    expect(reopened.result.current.unsorted.map((action) => action.text))
      .toEqual(expect.arrayContaining(["Older pending card", "Newest pending card owns Undo"]));
    expect(reopened.result.current.data.corrections).toEqual([]);
    reopened.unmount();
    const afterUndoReload = await mount();
    expect(afterUndoReload.result.current.unsorted.map((action) => action.text))
      .toEqual(expect.arrayContaining(["Older pending card", "Newest pending card owns Undo"]));
  });

  it("does not acknowledge manual Undo when its durable write fails", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    stubSortFetch(vi.fn());
    const hook = await mount();
    act(() => hook.result.current.setText("Manual Undo must persist first"));
    await act(async () => { await hook.result.current.submit(); });
    await act(async () => {
      await hook.result.current.manualSort(hook.result.current.unsorted[0], { kind: "action" });
    });
    const before = JSON.stringify(hook.result.current.data);
    vi.spyOn(storage, "setMany").mockRejectedValueOnce(new DOMException("quota", "QuotaExceededError"));

    await act(async () => { await hook.result.current.undoManual(); });

    expect(JSON.stringify(hook.result.current.data)).toBe(before);
    expect(hook.result.current.canUndoManual).toBe(true);
    expect(hook.result.current.err).toBe("Couldn't save Undo. Nothing was changed.");
  });

  it("fails a stale manual Undo without reverting a later edit or teaching a correction", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    stubSortFetch(vi.fn());
    const hook = await mount();
    act(() => hook.result.current.setText("Later edited manual destination"));
    await act(async () => { await hook.result.current.submit(); });
    await act(async () => {
      await hook.result.current.manualSort(hook.result.current.unsorted[0], { kind: "action" });
    });
    const action = hook.result.current.data.actions.find((item) => !item.unsorted)!;
    await act(async () => { await hook.result.current.editActionText(action.id, "Edited after filing"); });

    await act(async () => { await hook.result.current.undoManual(); });

    expect(hook.result.current.data.actions.find((item) => item.id === action.id)?.text)
      .toBe("Edited after filing");
    expect(hook.result.current.unsorted).toHaveLength(0);
    expect(hook.result.current.data.corrections).toEqual([]);
    expect(hook.result.current.err).toMatch(/changed since it was filed/i);
  });

  it("makes a manual choice durable and authoritative over its canceled delayed model result", async () => {
    const delayed = deferred<Response>();
    let captureId = "";
    let sortSignal: AbortSignal | undefined;
    stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      const request = JSON.parse(String(init?.body));
      captureId = request.captureId;
      sortSignal = init?.signal ?? undefined;
      return delayed.promise;
    }));
    const hook = await mount();
    act(() => {
      hook.result.current.setText("The person chooses this Action");
      hook.result.current.setTranscript("The person, um, chooses this Action");
    });
    await act(async () => { await hook.result.current.submit(true); });
    const pending = hook.result.current.unsorted[0];

    await act(async () => {
      await hook.result.current.manualSort(pending, { kind: "action" });
    });

    expect(sortSignal?.aborted).toBe(true);
    expect(hook.result.current.unsorted).toHaveLength(0);
    expect(hook.result.current.data.actions).toEqual([
      expect.objectContaining({
        text: "The person chooses this Action",
        shelf: "keep",
      }),
    ]);
    expect(hook.result.current.data.ledger.find((entry) =>
      entry.captureId === captureId && entry.kind === "action" && !entry.undone
    )).toMatchObject({
      raw: "The person chooses this Action",
      transcript: "The person, um, chooses this Action",
      settledBy: "manual",
    });
    const persisted = JSON.parse((await storage.get(KEY))!);
    expect(persisted.actions.filter((action: { text: string }) =>
      action.text === "The person chooses this Action"
    )).toHaveLength(1);
    expect(JSON.parse((await storage.get(TOMBSTONE_KEY))!)).toEqual([
      expect.objectContaining({ kind: "action", id: pending.id }),
    ]);

    await act(async () => {
      delayed.resolve(responseFor(captureId, "The person chooses this Action"));
    });
    await Promise.resolve();
    expect(hook.result.current.data.actions.filter((action) =>
      action.text === "The person chooses this Action"
    )).toHaveLength(1);
    expect(hook.result.current.data.ledger.filter((entry) =>
      entry.captureId === captureId && entry.kind !== "pending" && !entry.undone
    )).toHaveLength(1);
  });

  it("atomically settles a still-pending response without duplicate artifacts", async () => {
    stubSortFetch(vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "/api/sort") return new Response(null, { status: 503 });
      const request = JSON.parse(String(init?.body));
      return responseFor(request.captureId, request.raw);
    }));
    const hook = await mount();
    act(() => hook.result.current.setText("One planned action"));
    await act(async () => { await hook.result.current.submit(); });

    await waitFor(() => expect(hook.result.current.unsorted).toHaveLength(0));
    expect(hook.result.current.data.actions.filter((item) => item.text === "One planned action")).toHaveLength(1);
    const persisted = JSON.parse((await storage.get(KEY))!);
    expect(persisted.actions.filter((item: { text: string }) => item.text === "One planned action")).toHaveLength(1);
    expect(persisted.ledger.filter((entry: { kind: string; undone?: boolean }) =>
      entry.kind === "action" && !entry.undone
    )).toHaveLength(1);
    const tombstones = JSON.parse((await storage.get(TOMBSTONE_KEY))!);
    expect(tombstones).toEqual([
      expect.objectContaining({ kind: "action", id: expect.any(String) }),
    ]);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === "/api/sort")).toHaveLength(1);
  });
});
