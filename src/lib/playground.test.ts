import { describe, expect, it } from "vitest";
import { isClosedInPlayground, PLAYGROUND_CLOSED } from "./playground";

describe("playground — what the server refuses", () => {
  it("closes every route that reaches past the browser", () => {
    for (const p of PLAYGROUND_CLOSED) expect(isClosedInPlayground(p)).toBe(true);
    /* Sub-paths too: /api/img/<id> is how a picture is fetched. */
    expect(isClosedInPlayground("/api/img/abc123")).toBe(true);
  });

  it("leaves the model routes open — they are the point", () => {
    for (const p of ["/api/sort", "/api/distill", "/api/organize", "/api/summarize", "/api/intention", "/api/group"])
      expect(isClosedInPlayground(p)).toBe(false);
  });

  it("does not match by prefix accident", () => {
    /* "/api/synchronize" is not "/api/sync". */
    expect(isClosedInPlayground("/api/synchronize")).toBe(false);
  });
});
