import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getSync: vi.fn(),
  pushSync: vi.fn(),
  hubStore: vi.fn(),
  cloudGet: vi.fn(),
  cloudPut: vi.fn(),
}));

vi.mock("@/lib/syncStore", () => ({
  getSync: state.getSync,
  pushSync: state.pushSync,
}));
vi.mock("@/lib/hubStore", () => ({
  usingBlob: () => false,
  hubStore: state.hubStore,
}));
vi.mock("@/lib/limiter", () => ({
  limitFromEnv: () => 60,
  rateLimit: () => ({ allowed: true, retryAfterSec: 0 }),
}));
vi.mock("@/app/api/cloud/board/route", () => ({
  GET: state.cloudGet,
  PUT: state.cloudPut,
}));
vi.mock("@/lib/cloudImage", () => ({
  handleCloudImage: vi.fn(),
}));

import { GET as syncGet, POST as syncPost } from "@/app/api/sync/route";
import { GET as imageGet, HEAD as imageHead, PUT as imagePut } from "@/app/api/img/[id]/route";

const imageContext = { params: Promise.resolve({ id: "synthetic-photo" }) };

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("CAPTURE_LOCAL_TEST_PREVIEW", "1");
  vi.stubEnv("CAPTURE_CLOUD", "1");
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("disposable local Preview privacy boundary", () => {
  it("does not read or write the shared board hub", async () => {
    const getResponse = await syncGet(new Request("https://preview.test/api/sync"));
    const postResponse = await syncPost(new Request("https://preview.test/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board: {}, tombstones: [] }),
    }));

    expect(getResponse.status).toBe(404);
    expect(postResponse.status).toBe(404);
    expect(state.getSync).not.toHaveBeenCalled();
    expect(state.pushSync).not.toHaveBeenCalled();
    expect(state.cloudGet).not.toHaveBeenCalled();
    expect(state.cloudPut).not.toHaveBeenCalled();
  });

  it("does not probe, read, or upload image bytes to any shared store", async () => {
    const headResponse = await imageHead(
      new Request("https://preview.test/api/img/synthetic-photo", { method: "HEAD" }),
      imageContext,
    );
    const getResponse = await imageGet(
      new Request("https://preview.test/api/img/synthetic-photo"),
      imageContext,
    );
    const putResponse = await imagePut(
      new Request("https://preview.test/api/img/synthetic-photo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ src: "data:image/png;base64,c3ludGhldGlj" }),
      }),
      imageContext,
    );

    expect(headResponse.status).toBe(404);
    expect(getResponse.status).toBe(404);
    expect(putResponse.status).toBe(404);
    expect(state.hubStore).not.toHaveBeenCalled();
  });

  it("cannot be activated on Production even if the Preview flag leaks there", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("CAPTURE_CLOUD", "0");
    state.getSync.mockResolvedValue({ board: {}, tombstones: [], rev: 1 });

    const response = await syncGet(new Request("https://capture.test/api/sync"));

    expect(response.status).toBe(200);
    expect(state.getSync).toHaveBeenCalledOnce();
  });
});
