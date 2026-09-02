import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ exists: vi.fn(), write: vi.fn() }));

vi.mock("@/lib/clientIp", () => ({ clientIp: () => "test" }));
vi.mock("@/lib/limiter", () => ({
  limitFromEnv: () => 120,
  rateLimit: () => ({ allowed: true }),
}));
vi.mock("@/lib/hubStore", () => ({
  hubStore: () => ({ exists: state.exists, write: state.write }),
}));

import { HEAD } from "@/app/api/img/[id]/route";

describe("HEAD /api/img/[id]", () => {
  beforeEach(() => {
    state.exists.mockReset();
    state.write.mockReset();
  });

  it("confirms an existing image without returning its bytes", async () => {
    state.exists.mockResolvedValue(true);

    const response = await HEAD(
      new Request("https://capture.test/api/img/photo-1", { method: "HEAD" }),
      { params: Promise.resolve({ id: "photo-1" }) }
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(state.exists).toHaveBeenCalledWith("img/photo-1");
  });
});

describe("PUT /api/img/[id]", () => {
  beforeEach(() => {
    state.exists.mockReset();
    state.write.mockReset();
  });

  it("creates only when absent and treats a concurrent winner as success", async () => {
    state.exists.mockResolvedValue(false);
    state.write.mockResolvedValue(false);
    const src = "data:image/webp;base64,dGlueQ==";

    const { PUT } = await import("@/app/api/img/[id]/route");
    const response = await PUT(
      new Request("https://capture.test/api/img/photo-2", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ src }),
      }),
      { params: Promise.resolve({ id: "photo-2" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, stored: false });
    expect(state.write).toHaveBeenCalledWith("img/photo-2", src, {
      version: null,
    });
  });
});
