import { expect, it, vi } from "vitest";
import { EMPTY } from "./model";
import { requestBoardSort, requestIntentionExpansion } from "./resortOps";

const response = (retry?: string, error = "quota exceeded") => Response.json({ error }, {
  status: 429, headers: { Date: "Wed, 30 Sep 2026 09:00:00 GMT", ...(retry ? { "Retry-After": retry } : {}) },
});
const sort = (reply: Response) => requestBoardSort({ request: async () => reply, board: EMPTY, raw: "Keep this thought", forgottenRules: [], noteVia: () => {}, errorFor: message => new Error(message) });

it("reports the server reset time instead of raw quota text", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2030-01-01T00:00:00Z"));
  try {
    const error = await sort(response("3600")).catch(error => error);
    expect(error.resetAt).toBe(Date.parse("2026-09-30T10:00:00Z"));
    expect(error.message).toContain("Your AI allowance resets");
    expect(error.captureMessage).toContain("Saved in Unsorted.");
    expect(error.captureMessage).toContain("Choose a place now, or retry after that.");
  } finally { clock.mockRestore(); }
});
it("uses the same reset information for Intention details", async () => {
  const error = await requestIntentionExpansion(async () => response("3600"), "I rest", [], () => EMPTY).catch(error => error);
  expect(error.resetAt).toBe(Date.parse("2026-09-30T10:00:00Z"));
  expect(error.message).toContain("Your AI allowance resets");
});
it("does not invent a reset time when the header is missing", async () => {
  const error = await sort(response()).catch(error => error);
  expect(error.resetAt).toBeNull();
  expect(error.message).toContain("The reset time is unavailable");
});
it("does not mislabel another rate limit as the account allowance", async () => {
  const error = await sort(response("60", "Too many requests")).catch(error => error);
  expect(error.message).toBe("Too many requests");
  expect(error.resetAt).toBeUndefined();
});
