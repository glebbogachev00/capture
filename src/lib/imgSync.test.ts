import { describe, expect, it } from "vitest";
import type { Board } from "./model";
import { appendLedger, LEDGER_CAP, type CaptureEntry } from "./ledger";
import { ensureHubImage, isSafeImageId, referencedImageIds } from "./imgSync";

const board = (over: Partial<Board> = {}): Board => ({
  actions: [],
  threads: [],
  intentions: [],
  principles: [],
  ledger: [],
  corrections: [],
  ...over,
});

describe("referencedImageIds", () => {
  it("ignores untrusted board references that could escape the image route", () => {
    expect(referencedImageIds(board({ profile: { name: "A", imageId: "../cloud/board" } }))).toEqual([]);
  });
  it("collects ids from actions and from fragments inside threads", () => {
    const b = board({
      actions: [
        { id: "a1", text: "x", done: false, at: 0, shelf: "keep", expires: null, imgs: ["i1", "i2"] },
        { id: "a2", text: "y", done: false, at: 0, shelf: "keep", expires: null },
      ],
      threads: [
        {
          id: "t1",
          name: "T",
          summary: "",
          frags: [
            { id: "f1", at: 0, text: "n", imgs: ["i3"] },
            { id: "f2", at: 0, text: "n" },
          ],
        },
      ],
    });
    expect(referencedImageIds(b).sort()).toEqual(["i1", "i2", "i3"]);
  });

  it("keeps intention images referenced after their ledger row is evicted", () => {
    const intentionPhoto = "intention-photo";
    let ledger: CaptureEntry[] = [{
      id: "intention-row",
      at: 0,
      raw: "I live deliberately",
      clean: "I live deliberately",
      kind: "intention",
      source: "typed",
      targetId: "intention",
      imgs: [intentionPhoto],
    }];
    for (let index = 1; index <= LEDGER_CAP + 1; index++) {
      ledger = appendLedger(ledger, {
        id: `row-${index}`,
        at: index,
        raw: `capture ${index}`,
        clean: `capture ${index}`,
        kind: "action",
        source: "typed",
        targetId: `action-${index}`,
      });
    }
    expect(ledger.some((entry) => entry.id === "intention-row")).toBe(false);

    const b = board({
      ledger,
      intentions: [{
        id: "intention",
        number: 1,
        rawInput: "I live deliberately",
        expandedIntention: "I live deliberately.",
        recommendedActions: [],
        counterIntentions: [],
        imgs: [intentionPhoto],
        at: 0,
        updatedAt: 0,
      }],
    });
    expect(referencedImageIds(b)).toContain(intentionPhoto);
  });

  it("de-duplicates an image referenced twice", () => {
    const b = board({
      actions: [
        { id: "a1", text: "x", done: false, at: 0, shelf: "keep", expires: null, imgs: ["same"] },
      ],
      threads: [
        { id: "t1", name: "T", summary: "", frags: [{ id: "f1", at: 0, text: "n", imgs: ["same"] }] },
      ],
    });
    expect(referencedImageIds(b)).toEqual(["same"]);
  });

  it("is empty on a board with no photos", () => {
    expect(referencedImageIds(board())).toEqual([]);
  });

  it("collects a thread's photo cover", () => {
    // The regression: a cover is picked from the file input and hangs off no
    // fragment, so it was never reconciled — the other device got the id and
    // no bytes, and the cover came up blank.
    const b = board({
      threads: [
        { id: "t1", name: "T", summary: "", frags: [], cover: "img:cov1" },
      ],
    });
    expect(referencedImageIds(b)).toEqual(["cov1"]);
  });

  it("collects the synced profile photo", () => {
    const b = board({
      profile: {
        name: "Gleb",
        imageId: "profile-photo",
        updatedAt: 100,
      },
    });

    expect(referencedImageIds(b)).toEqual(["profile-photo"]);
  });

  it("ignores a tone cover, which carries no photo", () => {
    const b = board({
      threads: [
        { id: "t1", name: "T", summary: "", frags: [], cover: "tone:sage" },
      ],
    });
    expect(referencedImageIds(b)).toEqual([]);
  });

  it("de-duplicates a cover that is also a fragment's photo", () => {
    const b = board({
      threads: [
        {
          id: "t1",
          name: "T",
          summary: "",
          frags: [{ id: "f1", at: 0, text: "n", imgs: ["same"] }],
          cover: "img:same",
        },
      ],
    });
    expect(referencedImageIds(b)).toEqual(["same"]);
  });
});

describe("isSafeImageId", () => {
  it("accepts the ids the app actually mints", () => {
    expect(isSafeImageId("k3j4h5g6")).toBe(true);
    expect(isSafeImageId("a-b_c123")).toBe(true);
  });

  it("rejects anything that could climb out of the directory", () => {
    for (const bad of ["../secret", "a/b", "..", "", "a".repeat(65), "a.b", "a b"]) {
      expect(isSafeImageId(bad), bad).toBe(false);
    }
  });
});

describe("ensureHubImage", () => {
  it("refuses unsafe IDs without making a request", async () => {
    let called = false;
    const confirmed = await ensureHubImage("../cloud/board", "data:image/png;base64,x", async () => {
      called = true;
      return new Response(null, { status: 404 });
    });
    expect(called).toBe(false);
    expect(confirmed).toBe(false);
  });
  it("does not send image bytes when the hub already has the image", async () => {
    const calls: { method: string; body: BodyInit | null | undefined }[] = [];
    const request = async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", body: init?.body });
      return new Response(null, { status: 204 });
    };

    const confirmed = await ensureHubImage(
      "photo-1",
      "data:image/webp;base64,already-stored",
      request
    );

    expect(confirmed).toBe(true);
    expect(calls).toEqual([{ method: "HEAD", body: undefined }]);
  });

  it("sends image bytes only after the hub reports that they are missing", async () => {
    const calls: { method: string; body: BodyInit | null | undefined }[] = [];
    const request = async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", body: init?.body });
      return new Response(null, { status: calls.length === 1 ? 404 : 200 });
    };
    const src = "data:image/webp;base64,new-photo";

    const confirmed = await ensureHubImage("photo-2", src, request);

    expect(confirmed).toBe(true);
    expect(calls).toEqual([
      { method: "HEAD", body: undefined },
      { method: "PUT", body: JSON.stringify({ src }) },
    ]);
  });

  it.each([401, 402, 403, 429, 500, 503])("does not upload when the existence check fails with %s", async (status) => {
    const calls: { method: string; body: BodyInit | null | undefined }[] = [];
    const request = async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", body: init?.body });
      return new Response(null, { status });
    };

    const confirmed = await ensureHubImage(
      "photo-3",
      "data:image/webp;base64,keep-local",
      request
    );

    expect(confirmed).toBe(false);
    expect(calls).toEqual([{ method: "HEAD", body: undefined }]);
  });
});
