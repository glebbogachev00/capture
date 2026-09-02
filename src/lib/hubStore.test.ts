import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileStore, isMissingFileError, strongEtag } from "./hubStore";

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

describe("isMissingFileError", () => {
  it("distinguishes a missing file from a storage failure", () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });

    expect(isMissingFileError(missing)).toBe(true);
    expect(isMissingFileError(denied)).toBe(false);
    expect(isMissingFileError(new Error("network failure"))).toBe(false);
  });
});

describe("fileStore create-if-absent", () => {
  it("keeps the first immutable image when a second writer races", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "capture-hub-"));
    try {
      const store = fileStore(dir);

      expect(await store.write("img/photo-1", "first", { version: null })).not.toBe(false);
      expect(await store.write("img/photo-1", "second", { version: null })).toBe(false);
      expect((await store.read("img/photo-1"))?.body).toBe("first");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("still replaces an existing board after reading its local version", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "capture-hub-"));
    try {
      const store = fileStore(dir);
      await store.write("sync.json", "first", { version: null });
      const stored = await store.read("sync.json");

      expect(stored?.version).not.toBeNull();
      expect(await store.write("sync.json", "second", {
        version: stored?.version ?? null,
      })).not.toBe(false);
      expect((await store.read("sync.json"))?.body).toBe("second");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
