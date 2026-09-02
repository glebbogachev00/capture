import { describe, expect, it } from "vitest";
import type { Board } from "./model";
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

  it("does not upload when the existence check fails", async () => {
    const calls: { method: string; body: BodyInit | null | undefined }[] = [];
    const request = async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", body: init?.body });
      return new Response(null, { status: 500 });
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
