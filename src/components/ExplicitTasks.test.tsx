/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Capture } from "@/app/Capture";
import { EMPTY, KEY, hydrate } from "@/lib/model";
import { get, set } from "@/lib/storage";
import { explicitTasks, explicitTasksRaw, releaseIdea } from "@/lib/explicitTasks.fixture";
import type { PlannedRoutingPlan } from "@/lib/plannedRouting";
import { stubSortFetch } from "../../test/simpleSortFetch";

// Supply the App Router boundary without a checkout or Cloud account.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(async () => {
  await set(KEY, JSON.stringify(EMPTY));
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// These are deliberately provider-response fixtures, NOT model-compliance tests.
// The real Capture UI/hook files, ledger, IndexedDB writes and hydration run.
describe("explicit tasks survive the visible board and reload", () => {
  it.each([
    { name: "four actions", kind: "action", raw: explicitTasksRaw.split(" While I am in there,")[0], actions: explicitTasks },
    { name: "four actions plus the separate idea, including onboarding", kind: "both", raw: explicitTasksRaw, actions: explicitTasks },
    { name: "one task", kind: "action", raw: "I need to call the dentist tomorrow.", actions: ["Call the dentist tomorrow"] },
    { name: "related clauses remain one task", kind: "action", raw: "Stop over building. Create workflows and have engineering handle this. Do all the verification and checks.", actions: ["Create workflows so engineering handles verification and checks without overbuilding"] },
    { name: "pure thinking has no invented commitment", kind: "thread", raw: `I keep thinking about a later product idea: ${releaseIdea}.`, actions: [] },
  ])("$name", async ({ kind, raw, actions }) => {
    const hasThread = kind !== "action";
    const sortRequests: string[] = [];
    stubSortFetch(vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/sort") {
        const request = JSON.parse(String(init?.body));
        sortRequests.push(request.raw);
        const thoughtStart = hasThread && actions.length ? raw.indexOf(releaseIdea) : 0;
        const actionSource = hasThread ? raw.slice(0, thoughtStart) : raw;
        const cuts = Array.from({ length: actions.length + 1 }, (_, index) =>
          Math.floor(actionSource.length * index / Math.max(1, actions.length)));
        const pieces = actions.map((_, index) => actionSource.slice(cuts[index], cuts[index + 1]));
        const routingPlan: PlannedRoutingPlan = {
          items: [
            ...actions.map((action, index) => ({
              id: `action-${index}`,
              source: pieces[index],
              kind: "action" as const,
              action,
              due: null,
              ownerId: null,
              destinations: [],
              duplicateActionId: null,
              unresolved: false,
              ambiguity: null,
            })),
            ...(hasThread ? [{
              id: "thinking",
              source: raw.slice(thoughtStart),
              kind: "developing_thought" as const,
              action: null,
              due: null,
              ownerId: null,
              destinations: [{ type: "new" as const, newThreadKey: "release" }],
              duplicateActionId: null,
              unresolved: false,
              ambiguity: null,
            }] : []),
          ],
          newThreads: hasThread ? [{
            key: "release",
            name: "Release assistant idea",
            closestExistingThreadId: null,
            whyNew: "Synthetic provider fixture declares the separate thought destination.",
          }] : [],
        };
        const recovery = { clean: raw, kind, title: "App launch tasks", actions,
          primaryActions: [],
          shelfLife: "keep", due: null, threadId: null,
          threadName: hasThread ? "Release assistant idea" : null, primaryText: null, also: null,
          via: "mock-provider" };
        return Response.json({ ...recovery, planned: true, captureId: request.captureId,
          routingPlan, recovery });
      }
      // All ancillary calls fail closed; never touch a real hub or provider.
      return Response.json({ error: "test isolation" }, { status: 503 });
    }));
    const screen = render(<Capture />);
    // The textarea mounts before the initial IndexedDB sweep finishes.
    // Wait for the loaded empty board so initialization cannot race the capture.
    await screen.findByText("No open loops.");
    fireEvent.change(screen.container.querySelector("textarea")!, { target: { value: raw } });
    fireEvent.keyDown(screen.container.querySelector("textarea")!, { key: "Enter", code: "Enter", metaKey: true });
    await waitFor(async () => {
      const board = hydrate(JSON.parse((await get(KEY))!));
      expect(board.actions.map((a) => a.text)).toEqual(actions);
      expect(board.threads).toHaveLength(hasThread ? 1 : 0);
      expect(board.ledger.at(-1)?.raw).toBe(raw);
    });
    expect(sortRequests).toEqual([raw]);
    if (hasThread) {
      expect(screen.getAllByText("Release assistant idea").length).toBeGreaterThan(0);
      const saved = hydrate(JSON.parse((await get(KEY))!));
      expect(saved.threads[0].frags[0].text).toContain(releaseIdea);
      expect(saved.actions.some((a) => /release assistant/i.test(a.text))).toBe(false);
    }
    if (actions.length) {
      fireEvent.click(screen.getByRole("button", { name: /^Actions/i }));
      await waitFor(() => expect(screen.container.querySelectorAll(".act")).toHaveLength(actions.length));
      for (const task of actions) expect(screen.getByText(task)).toBeTruthy();
    }
    screen.unmount();
    const reloaded = render(<Capture />);
    if (actions.length) {
      const actionTab = await reloaded.findByRole("button", {
        name: new RegExp(`^Actions ${actions.length}$`, "i"),
      });
      fireEvent.click(actionTab);
      await waitFor(() => expect(reloaded.container.querySelectorAll(".act")).toHaveLength(actions.length));
      for (const task of actions) expect(reloaded.getByText(task)).toBeTruthy();
    } else {
      const threadTab = await reloaded.findByRole("button", { name: /^Threads 1$/i });
      fireEvent.click(threadTab);
      await waitFor(() => expect(reloaded.getByText("Release assistant idea")).toBeTruthy());
      expect(reloaded.container.querySelectorAll(".act")).toHaveLength(0);
    }
  });
});
