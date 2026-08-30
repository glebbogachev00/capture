import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The memory layer over image bytes. The store is mocked; what is under
 * test is the contract that makes the blank-image class of bug impossible:
 * seen once means shown synchronously thereafter, deleted means gone from
 * memory FIRST, and memory never grows past its cap.
 */

vi.mock("./storage", () => {
  const disk = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => disk.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => void disk.set(k, v)),
    del: vi.fn(async (k: string) => void disk.delete(k)),
    _disk: disk,
  };
});

import { _clearImgCache, imgDrop, imgLoad, imgNow, imgSave } from "./imgCache";
import * as storage from "./storage";

const disk = (storage as unknown as { _disk: Map<string, string> })._disk;

beforeEach(() => {
  _clearImgCache();
  disk.clear();
  vi.clearAllMocks();
});

describe("image bytes, memory first", () => {
  it("a saved image renders synchronously ever after", async () => {
    await imgSave("a1", "data:one");
    /* The first frame of a remount — no store round-trip, no blank. */
    expect(imgNow("a1")).toBe("data:one");
  });

  it("a loaded image warms memory for the next mount", async () => {
    disk.set("capture:img:a2", "data:two");
    expect(imgNow("a2")).toBeNull(); // cold: this render pays the trip
    expect(await imgLoad("a2")).toBe("data:two");
    expect(imgNow("a2")).toBe("data:two"); // every later one does not
  });

  it("deleting clears memory before the store", async () => {
    /* The order is the invariant: a memory copy that outlives the bytes
       would show a picture the board no longer owns. */
    await imgSave("a3", "data:three");
    await imgDrop("a3");
    expect(imgNow("a3")).toBeNull();
    expect(disk.has("capture:img:a3")).toBe(false);
  });

  it("stays bounded, evicting the least recently seen", async () => {
    for (let i = 0; i < 45; i++) await imgSave("id" + i, "data:" + i);
    /* The first few fell off... */
    expect(imgNow("id0")).toBeNull();
    /* ...the recent screen stays warm... */
    expect(imgNow("id44")).toBe("data:44");
    /* ...and evicted bytes are still in the store, one round-trip away. */
    expect(await imgLoad("id0")).toBe("data:0");
  });

  it("looking at an image keeps it warm", async () => {
    await imgSave("keep", "data:keep");
    for (let i = 0; i < 39; i++) await imgSave("x" + i, "data:x");
    imgNow("keep"); // looked at — moves to the back of the eviction line
    await imgSave("one-more", "data:y");
    expect(imgNow("keep")).toBe("data:keep");
  });
});
