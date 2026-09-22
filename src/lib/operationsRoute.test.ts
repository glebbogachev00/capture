import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  run: vi.fn(),
  event: vi.fn(),
}));

vi.mock("@/lib/operations.server", () => ({
  authorizeOperationsWorker: mocks.authorize,
  runOperationalMaintenance: mocks.run,
}));
vi.mock("@/lib/opsEvent.server", () => ({ opsEvent: mocks.event }));

import { POST } from "@/app/api/cloud/operations/cron/route";

const request = () => new Request("https://capture.test/api/cloud/operations/cron", {
  method: "POST",
  headers: { authorization: "Bearer synthetic" },
});
const healthy = {
  overdueErasures: "ok",
  billingReconciliation: "ok",
  webhookDelivery: "ok",
  imagePressure: "ok",
  quotaPressure: "ok",
  readinessDrift: "ok",
  maintenance: "ok",
} as const;

describe("operations cron route", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["unavailable", 503, "operations worker unavailable"],
    ["unauthorized", 401, "unauthorized"],
  ] as const)("fails closed when authorization is %s", async (authorization, status, message) => {
    mocks.authorize.mockReturnValue(authorization);
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: message });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("returns only fixed aggregate states", async () => {
    mocks.authorize.mockReturnValue("authorized");
    mocks.run.mockResolvedValue(healthy);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signals: healthy });
    expect(mocks.event).toHaveBeenLastCalledWith({
      event: "operational_health", outcome: "success", reason: "none",
    });
  });

  it("makes critical state visible to the external scheduler alert contract", async () => {
    mocks.authorize.mockReturnValue("authorized");
    mocks.run.mockResolvedValue({ ...healthy, overdueErasures: "critical" });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ signals: { ...healthy, overdueErasures: "critical" } });
    expect(mocks.event).toHaveBeenLastCalledWith({
      event: "operational_health", outcome: "degraded", reason: "backlog_present",
    });
  });

  it("does not expose provider failures", async () => {
    mocks.authorize.mockReturnValue("authorized");
    mocks.run.mockRejectedValue(new Error("PRIVATE_PROVIDER_MESSAGE"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE_");
    expect(JSON.stringify(mocks.event.mock.calls)).not.toContain("PRIVATE_");
  });
});
