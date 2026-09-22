import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCloudConfig: vi.fn(),
  createCloudServerClient: vi.fn(),
  identityFromClaims: vi.fn(),
  repositoryGet: vi.fn(),
  repositoryCreate: vi.fn(),
  repositoryUpdate: vi.fn(),
  repositoryConstructor: vi.fn(),
}));

vi.mock("@/lib/supabase/config", () => ({
  getCloudConfig: mocks.getCloudConfig,
}));

vi.mock("@/lib/supabase/server", () => ({
  createCloudServerClient: mocks.createCloudServerClient,
}));

vi.mock("@/lib/supabase/identity", () => ({
  identityFromClaims: mocks.identityFromClaims,
}));

vi.mock("@/lib/supabase/repository", () => ({
  CloudBoardRepository: class {
    constructor(client: unknown) {
      mocks.repositoryConstructor(client);
    }

    get = mocks.repositoryGet;
    create = mocks.repositoryCreate;
    update = mocks.repositoryUpdate;
  },
}));

import { GET } from "@/app/api/cloud/board/route";
import { GET as syncGet, POST as syncPost } from "@/app/api/sync/route";

const request = () => new Request("https://capture.test/api/cloud/board", { headers: { "X-Capture-Owner": "user-1" } });
const readyConfig = {
  status: "ready" as const,
  url: "https://capture.supabase.co",
  publishableKey: "sb_publishable_test",
};

describe("Cloud board route composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.getCloudConfig.mockReturnValue(null);
    mocks.repositoryGet.mockResolvedValue(null);
    mocks.repositoryCreate.mockResolvedValue(null);
    mocks.repositoryUpdate.mockResolvedValue(null);
  });

  it("does not initialize Supabase while Cloud is disabled", async () => {
    vi.stubEnv("CAPTURE_CLOUD", "0");

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mocks.createCloudServerClient).not.toHaveBeenCalled();
    expect(mocks.identityFromClaims).not.toHaveBeenCalled();
    expect(mocks.repositoryConstructor).not.toHaveBeenCalled();
  });

  it("returns a bounded error without initializing Supabase when configuration is missing", async () => {
    vi.stubEnv("CAPTURE_CLOUD", "1");
    mocks.getCloudConfig.mockReturnValue({ status: "missing" });

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "cloud is not configured" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.createCloudServerClient).not.toHaveBeenCalled();
  });

  it("composes a fresh configured client, verified identity, and tenant-scoped repository", async () => {
    vi.stubEnv("CAPTURE_CLOUD", "1");
    vi.stubEnv("CAPTURE_CLOUD_REQUIRE_SUBSCRIPTION", "0");
    const rpc = vi.fn().mockImplementation(async (name: string) => ({
      data: name === "capture_account_deleting" ? false : { allowed: true, retryAfterSec: 0 },
      error: null,
    }));
    const client = { auth: { getClaims: vi.fn() }, rpc };
    mocks.getCloudConfig.mockReturnValue(readyConfig);
    mocks.createCloudServerClient.mockResolvedValue(client);
    mocks.identityFromClaims.mockResolvedValue({ userId: "user-1" });

    const first = await GET(request());
    const second = await GET(request());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await first.json()).rev).toBe(0);
    expect(mocks.createCloudServerClient).toHaveBeenCalledTimes(2);
    expect(mocks.createCloudServerClient).toHaveBeenNthCalledWith(1, readyConfig);
    expect(mocks.identityFromClaims).toHaveBeenCalledTimes(2);
    expect(mocks.identityFromClaims).toHaveBeenCalledWith(client);
    expect(mocks.repositoryConstructor).toHaveBeenCalledTimes(2);
    expect(mocks.repositoryConstructor).toHaveBeenCalledWith(client);
    expect(mocks.repositoryGet).toHaveBeenCalledTimes(2);
    expect(mocks.repositoryGet).toHaveBeenCalledWith("user-1");
    expect(rpc).toHaveBeenCalledTimes(4);
    expect(rpc).toHaveBeenCalledWith("capture_account_deleting", { p_user_id: "user-1" });
    expect(rpc).toHaveBeenCalledWith("consume_capture_cloud_quota", {
      p_scope: "board_read",
    });
  });

  it("sync compatibility rejects stale and old clients before repository access", async () => {
    vi.stubEnv("CAPTURE_CLOUD", "1");
    vi.stubEnv("CAPTURE_CLOUD_REQUIRE_SUBSCRIPTION", "0");
    mocks.getCloudConfig.mockReturnValue(readyConfig);
    mocks.createCloudServerClient.mockResolvedValue({});
    mocks.identityFromClaims.mockResolvedValue({ userId: "B" });
    for (const method of ["GET", "POST"]) for (const owner of [undefined, "A"]) {
      const request = new Request("https://capture.test/api/sync", {
        method, headers: owner ? { "X-Capture-Owner": owner } : {},
        ...(method === "POST" ? { body: '{"board":{}}' } : {}),
      });
      const response = await (method === "GET" ? syncGet : syncPost)(request);
      expect(response.status).toBe(owner === undefined ? 428 : 412);
    }
    expect(mocks.repositoryGet).not.toHaveBeenCalled();
    expect(mocks.repositoryCreate).not.toHaveBeenCalled();
    expect(mocks.repositoryUpdate).not.toHaveBeenCalled();
  });

  it("stops before repository access when Supabase cannot verify a user", async () => {
    vi.stubEnv("CAPTURE_CLOUD", "1");
    const client = { auth: { getClaims: vi.fn() } };
    mocks.getCloudConfig.mockReturnValue(readyConfig);
    mocks.createCloudServerClient.mockResolvedValue(client);
    mocks.identityFromClaims.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(mocks.repositoryGet).not.toHaveBeenCalled();
  });
});
