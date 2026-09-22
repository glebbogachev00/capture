import { describe, expect, it, vi } from "vitest";
import {
  handleCloudSubscriptionStatus,
  isCurrentCloudEntitlement,
  isSubscriptionRequired,
  publicCloudSubscription,
  type CloudSubscriptionDependencies,
  type CloudSubscriptionRow,
} from "@/lib/cloudSubscription";
import { GET as defaultSubscriptionRoute } from "@/app/api/cloud/subscription/route";

const active: CloudSubscriptionRow = {
  status: "active",
  plan: "yearly",
  is_entitled: true,
  current_period_end: "2027-09-11T10:00:00.000Z",
  access_expires_at: "2027-09-11T10:00:00.000Z",
  cancel_at_period_end: false,
  last_event_at: "2026-09-11T10:00:00.000Z",
};

function deps(overrides: Partial<CloudSubscriptionDependencies> = {}): CloudSubscriptionDependencies {
  return {
    isEnabled: () => true,
    isConfigured: () => true,
    requiresSubscription: () => true,
    verifyIdentity: vi.fn().mockResolvedValue({ userId: "user-1" }),
    isAccountErasing: vi.fn().mockResolvedValue(false),
    getSubscriptions: vi.fn().mockResolvedValue([active]),
    getCloudAccess: vi.fn().mockResolvedValue({ current: true, complimentaryCurrent: false, complimentaryExpiresAt: null }),
    now: () => new Date("2026-09-11T10:00:00.000Z"),
    ...overrides,
  } as CloudSubscriptionDependencies;
}

describe("Capture Cloud subscription status", () => {
  it("requires paid access by default when Cloud is enabled", () => {
    expect(isSubscriptionRequired({ CAPTURE_CLOUD: "1" })).toBe(true);
    expect(isSubscriptionRequired({
      CAPTURE_CLOUD: "1",
      CAPTURE_CLOUD_REQUIRE_SUBSCRIPTION: "0",
    })).toBe(false);
    expect(isSubscriptionRequired({ CAPTURE_CLOUD: "0" })).toBe(false);
  });

  it("returns 401 before reading billing state when there is no verified user", async () => {
    const d = deps({ verifyIdentity: vi.fn().mockResolvedValue(null) });
    const response = await handleCloudSubscriptionStatus(new Request("https://capture.test/api/cloud/subscription"), d);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized", captureLimit: 15 });
    expect(d.getSubscriptions).not.toHaveBeenCalled();
  });

  it("returns only the public entitlement view and never provider identifiers", async () => {
    const response = await handleCloudSubscriptionStatus(new Request("https://capture.test/api/cloud/subscription"), deps());
    expect(await response.json()).toEqual({
      tier: "cloud",
      status: "active",
      plan: "yearly",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: "2027-09-11T10:00:00.000Z",
      accessExpiresAt: "2027-09-11T10:00:00.000Z",
      captureLimit: null,
    });
  });

  it("fences billing reads for a stale authenticated session immediately after confirmation", async () => {
    const d = deps({ isAccountErasing: vi.fn().mockResolvedValue(true) });
    const response = await handleCloudSubscriptionStatus(
      new Request("https://capture.test/api/cloud/subscription"),
      d,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "account unavailable" });
    expect(d.getSubscriptions).not.toHaveBeenCalled();
  });

  it("gives a signed-in free account the same fifteen local captures", async () => {
    const response = await handleCloudSubscriptionStatus(
      new Request("https://capture.test/api/cloud/subscription"),
      deps({
        getSubscriptions: vi.fn().mockResolvedValue([]),
        getCloudAccess: vi.fn().mockResolvedValue({ current: false, complimentaryCurrent: false, complimentaryExpiresAt: null }),
      }),
    );
    expect(await response.json()).toMatchObject({ tier: "free", captureLimit: 15 });
  });

  it("reports a current complimentary grant as Cloud without inventing Polar billing", async () => {
    const response = await handleCloudSubscriptionStatus(
      new Request("https://capture.test/api/cloud/subscription"),
      deps({
        getSubscriptions: vi.fn().mockResolvedValue([]),
        getCloudAccess: vi.fn().mockResolvedValue({
          current: true,
          complimentaryCurrent: true,
          complimentaryExpiresAt: "2027-01-01T00:00:00.000Z",
        }),
      }),
    );
    expect(await response.json()).toEqual({
      tier: "cloud",
      accessSource: "complimentary",
      status: "complimentary",
      plan: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      accessExpiresAt: "2027-01-01T00:00:00.000Z",
      captureLimit: null,
      canManageBilling: false,
    });
  });

  it("preserves unresolved paid reconciliation while complimentary access is active", () => {
    expect(publicCloudSubscription(
      [{ ...active, is_entitled: false, reconciliation_required: true }],
      new Date("2026-09-11T10:00:00.000Z"),
      true,
      { current: true, complimentaryCurrent: true, complimentaryExpiresAt: null },
    )).toMatchObject({
      tier: "cloud",
      accessSource: "complimentary",
      reconciliationRequired: true,
      canManageBilling: true,
    });
  });

  it("fails closed when the canonical access predicate is unavailable", async () => {
    const response = await handleCloudSubscriptionStatus(
      new Request("https://capture.test/api/cloud/subscription"),
      deps({ getCloudAccess: vi.fn().mockRejectedValue(new Error("missing predicate")) }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "subscription status is unavailable" });
  });

  it("does not impose Capture's public limit when subscriptions are optional", async () => {
    const response = await handleCloudSubscriptionStatus(
      new Request("https://capture.test/api/cloud/subscription"),
      deps({
        requiresSubscription: () => false,
        getSubscriptions: vi.fn().mockResolvedValue([]),
        getCloudAccess: vi.fn().mockResolvedValue({ current: false, complimentaryCurrent: false, complimentaryExpiresAt: null }),
      } as Partial<CloudSubscriptionDependencies>),
    );
    expect(await response.json()).toMatchObject({ tier: "free", captureLimit: null });
  });

  it("treats a missing or expired subscription as free", () => {
    expect(publicCloudSubscription(null, new Date("2026-09-11T10:00:00.000Z"))).toMatchObject({ tier: "free", status: "inactive" });
    expect(publicCloudSubscription([{ ...active, access_expires_at: "2026-09-10T10:00:00.000Z" }], new Date("2026-09-11T10:00:00.000Z"))).toMatchObject({ tier: "free", status: "active" });
  });

  it("keeps a scheduled cancellation active until its paid period ends", () => {
    const row = { ...active, status: "canceled", cancel_at_period_end: true };
    expect(isCurrentCloudEntitlement(row, new Date("2027-09-11T09:59:59.000Z"))).toBe(true);
    expect(isCurrentCloudEntitlement(row, new Date("2027-09-11T10:00:01.000Z"))).toBe(false);
  });

  it("keeps Cloud active when one of several subscriptions is still paid", () => {
    const revoked = {
      ...active,
      status: "revoked",
      is_entitled: false,
      access_expires_at: "2026-09-11T09:00:00.000Z",
      last_event_at: "2026-09-11T11:00:00.000Z",
    };
    expect(publicCloudSubscription([revoked, active], new Date("2026-09-11T10:00:00.000Z"))).toMatchObject({
      tier: "cloud",
      status: "active",
      plan: "yearly",
    });
  });

  it("bounds repository errors without leaking provider details", async () => {
    const response = await handleCloudSubscriptionStatus(
      new Request("https://capture.test/api/cloud/subscription"),
      deps({ getSubscriptions: vi.fn().mockRejectedValue(new Error("private database detail")) }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "subscription status is unavailable" });
  });

  it("keeps the default route unavailable when Cloud is disabled", async () => {
    vi.stubEnv("CAPTURE_CLOUD", "0");
    try {
      const response = await defaultSubscriptionRoute(
        new Request("https://capture.test/api/cloud/subscription"),
      );
      expect(response.status).toBe(404);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("fails closed when Cloud is enabled without Supabase configuration", async () => {
    vi.stubEnv("CAPTURE_CLOUD", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    try {
      const response = await defaultSubscriptionRoute(
        new Request("https://capture.test/api/cloud/subscription"),
      );
      expect(response.status).toBe(503);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
