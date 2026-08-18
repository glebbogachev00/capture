import { describe, expect, it } from "vitest";
import { strongEtag } from "./hubStore";

/**
 * The bug this pins cost a full day of silent sync failure.
 *
 * Blob hands back a weak validator once an object is big enough to be
 * stored compressed. `If-Match` uses strong comparison, so a weak tag never
 * matches: the first push created the blob (no precondition needed) and
 * every push afterwards failed the compare-and-swap, four attempts deep,
 * forever. The board stopped changing while the app still looked reachable.
 */
describe("strongEtag — the weak validator that broke sync", () => {
  it("strips the weak prefix so If-Match can match", () => {
    expect(strongEtag('W/"480f8d4eb2d83e4c9f71e6f17fef79f2"')).toBe(
      '"480f8d4eb2d83e4c9f71e6f17fef79f2"'
    );
  });

  it("leaves an already-strong tag exactly as it is", () => {
    expect(strongEtag('"082c26c8a6bc75226a31da5495cc9292"')).toBe(
      '"082c26c8a6bc75226a31da5495cc9292"'
    );
  });

  it("only strips a leading W/, never a W inside the value", () => {
    expect(strongEtag('"W/abc"')).toBe('"W/abc"');
  });

  it("no etag means no precondition, not an empty one", () => {
    expect(strongEtag(null)).toBeNull();
    expect(strongEtag(undefined)).toBeNull();
    expect(strongEtag("")).toBeNull();
  });
});
