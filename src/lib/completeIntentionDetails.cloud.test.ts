// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { EMPTY, type Board } from "./model";
import { installDocumentLifetime, OWNER_HEADER } from "./ownership";
import { completeIntentionDetails } from "./completeIntentionDetails";

afterEach(() => vi.unstubAllGlobals());

it("sends the verified Cloud owner when completing a mixed Intention", async () => {
  const lifetime = installDocumentLifetime({ owner: "details-test-owner", expiresAt: Date.now() + 60_000 });
  let board: Board = { ...EMPTY, intentions: [{
    id: "rest", number: 1, at: 1, updatedAt: 1,
    rawInput: "I allow myself to rest.", expandedIntention: "I allow myself to rest.",
    recommendedActions: [], counterIntentions: [],
  }] };
  const network = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (new Headers(init?.headers).get(OWNER_HEADER) !== "details-test-owner")
      return Response.json({ error: "Owner precondition required" }, { status: 428 });
    return Response.json({ expandedIntention: "Unwanted rewrite", recommendedActions: ["I take a walk."], counterIntentions: ["I keep checking work."] });
  });
  vi.stubGlobal("fetch", network);
  await completeIntentionDetails(["rest"], () => board, async build => {
    const next = build(board); if (next) board = next;
  }, () => lifetime.active);
  expect(network).toHaveBeenCalledTimes(1);
  expect(new Headers(network.mock.calls[0][1]?.headers).get(OWNER_HEADER)).toBe("details-test-owner");
  expect(board.intentions[0]).toMatchObject({
    expandedIntention: "I allow myself to rest.",
    recommendedActions: ["I take a walk."], counterIntentions: ["I keep checking work."],
  });
});
