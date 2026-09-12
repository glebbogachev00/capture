import { describe, expect, it, vi } from "vitest";
import {
  effectiveEntitlement,
  handleCheckout,
  handleCustomerPortal,
  handlePolarWebhook,
  normalizeSubscription,
  type PolarDependencies,
} from "@/lib/polar";

const config = {
  environment: "sandbox" as const,
  accessToken: "test-token",
  webhookSecret: "whsec_test",
  monthlyProductId: "11111111-1111-4111-8111-111111111111",
  yearlyProductId: "22222222-2222-4222-8222-222222222222",
  siteUrl: "https://trycapture.app",
};

function deps(overrides: Partial<PolarDependencies> = {}): PolarDependencies {
  return {
    config,
    isCloudEnabled: () => true,
    identity: vi.fn().mockResolvedValue({ userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "a@example.com" }),
    hasActiveSubscription: vi.fn().mockResolvedValue(false),
    createCheckout: vi.fn().mockResolvedValue({ url: "https://sandbox.polar.sh/checkout/1" }),
    createCustomerSession: vi.fn().mockResolvedValue({ customerPortalUrl: "https://sandbox.polar.sh/portal/1" }),
    validateWebhook: vi.fn().mockResolvedValue({
      type: "subscription.active",
      timestamp: "2026-09-11T10:00:00.000Z",
      data: {
        id: "sub_1",
        status: "active",
        customer_id: "cus_1",
        customer: { external_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        product_id: config.monthlyProductId,
        current_period_start: "2026-09-11T10:00:00.000Z",
        current_period_end: "2026-10-11T10:00:00.000Z",
        cancel_at_period_end: false,
      },
    }),
    applySubscriptionEvent: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("Polar checkout", () => {
  it("cannot charge when Capture Cloud is disabled", async () => {
    const d = deps({ isCloudEnabled: () => false });
    const response = await handleCheckout(new Request("https://capture.test/api/cloud/checkout", {
      method: "POST",
      body: JSON.stringify({ plan: "yearly" }),
    }), d);
    expect(response.status).toBe(404);
    expect(d.createCheckout).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    const response = await handleCheckout(new Request("https://capture.test/api/cloud/checkout", { method: "POST", body: JSON.stringify({ plan: "yearly" }) }), deps({ identity: vi.fn().mockResolvedValue(null) }));
    expect(response.status).toBe(401);
  });

  it("accepts only named plans and creates a server-bound checkout without a trial", async () => {
    const d = deps();
    const response = await handleCheckout(new Request("https://capture.test/api/cloud/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.4, 10.0.0.1" },
      body: JSON.stringify({ plan: "yearly", productId: "attacker-value" }),
    }), d);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://sandbox.polar.sh/checkout/1" });
    expect(d.createCheckout).toHaveBeenCalledWith({
      products: [config.yearlyProductId],
      externalCustomerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      customerEmail: "a@example.com",
      customerIpAddress: "203.0.113.4",
      successUrl: "https://trycapture.app/app?checkout_id={CHECKOUT_ID}",
      returnUrl: "https://trycapture.app/pricing",
      allowDiscountCodes: true,
      allowTrial: false,
      metadata: { capturePlan: "yearly" },
    });
  });

  it("can create checkout before the webhook secret has been issued", async () => {
    const d = deps({ config: { ...config, webhookSecret: null } });
    const response = await handleCheckout(new Request("https://capture.test/api/cloud/checkout", {
      method: "POST",
      body: JSON.stringify({ plan: "monthly" }),
    }), d);

    expect(response.status).toBe(200);
    expect(d.createCheckout).toHaveBeenCalledOnce();
  });

  it("rejects arbitrary products", async () => {
    const response = await handleCheckout(new Request("https://capture.test/api/cloud/checkout", { method: "POST", body: JSON.stringify({ plan: "enterprise" }) }), deps());
    expect(response.status).toBe(400);
  });

  it("does not create a second checkout while any paid entitlement remains active", async () => {
    const d = deps({ hasActiveSubscription: vi.fn().mockResolvedValue(true) });
    const response = await handleCheckout(new Request("https://capture.test/api/cloud/checkout", {
      method: "POST",
      body: JSON.stringify({ plan: "monthly" }),
    }), d);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "capture cloud is already active" });
    expect(d.createCheckout).not.toHaveBeenCalled();
  });
});

describe("Polar customer portal", () => {
  it("stays closed when Capture Cloud is disabled", async () => {
    const d = deps({ isCloudEnabled: () => false });
    const response = await handleCustomerPortal(new Request("https://capture.test/api/cloud/portal", { method: "POST" }), d);
    expect(response.status).toBe(404);
    expect(d.createCustomerSession).not.toHaveBeenCalled();
  });

  it("creates a short-lived portal session by immutable external customer id", async () => {
    const d = deps();
    const response = await handleCustomerPortal(new Request("https://capture.test/api/cloud/portal", { method: "POST" }), d);
    expect(await response.json()).toEqual({ url: "https://sandbox.polar.sh/portal/1" });
    expect(d.createCustomerSession).toHaveBeenCalledWith({
      externalCustomerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      returnUrl: "https://trycapture.app/app",
    });
  });
});

describe("Polar webhooks", () => {
  it("stays unavailable until a webhook secret is configured", async () => {
    const d = deps({ config: { ...config, webhookSecret: null } });
    const response = await handlePolarWebhook(new Request("https://capture.test/api/webhooks/polar", {
      method: "POST",
      headers: { "webhook-id": "evt_early" },
      body: "{}",
    }), d);

    expect(response.status).toBe(503);
    expect(d.validateWebhook).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature without touching billing state", async () => {
    const d = deps({ validateWebhook: vi.fn().mockRejectedValue(new Error("bad signature")) });
    const response = await handlePolarWebhook(new Request("https://capture.test/api/webhooks/polar", {
      method: "POST",
      headers: { "webhook-id": "evt_bad", "webhook-signature": "invalid", "webhook-timestamp": "1789120800" },
      body: "{}",
    }), d);
    expect(response.status).toBe(403);
    expect(d.applySubscriptionEvent).not.toHaveBeenCalled();
  });

  it("requires the Standard Webhooks delivery id and applies a verified subscription atomically", async () => {
    const d = deps();
    const response = await handlePolarWebhook(new Request("https://capture.test/api/webhooks/polar", {
      method: "POST",
      headers: { "webhook-id": "evt_1", "webhook-signature": "v1,test", "webhook-timestamp": "1789120800" },
      body: "{}",
    }), d);
    expect(response.status).toBe(202);
    expect(d.applySubscriptionEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "evt_1",
      eventType: "subscription.active",
      plan: "monthly",
      isEntitled: true,
      accessExpiresAt: "2026-10-11T10:00:00.000Z",
    }));
  });

  it("acknowledges unrelated Polar products without retrying or changing Capture access", async () => {
    const d = deps({
      validateWebhook: vi.fn().mockResolvedValue({
        type: "subscription.active",
        timestamp: "2026-09-11T10:00:00.000Z",
        data: {
          id: "sub_sponsor",
          status: "active",
          customer_id: "cus_sponsor",
          customer: { external_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
          product_id: "33333333-3333-4333-8333-333333333333",
          current_period_start: "2026-09-11T10:00:00.000Z",
          current_period_end: "2026-10-11T10:00:00.000Z",
          cancel_at_period_end: false,
        },
      }),
    });
    const response = await handlePolarWebhook(new Request("https://capture.test/api/webhooks/polar", {
      method: "POST",
      headers: { "webhook-id": "evt_other", "webhook-signature": "v1,test", "webhook-timestamp": "1789120800" },
      body: "{}",
    }), d);
    expect(response.status).toBe(202);
    expect(d.applySubscriptionEvent).not.toHaveBeenCalled();
  });

  it("keeps scheduled cancellations entitled only through the paid period", () => {
    const normalized = normalizeSubscription("subscription.canceled", "2026-09-11T10:00:00.000Z", {
      id: "sub_1", status: "active", customer_id: "cus_1",
      customer: { external_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      product_id: config.yearlyProductId,
      current_period_start: "2026-01-01T00:00:00.000Z",
      current_period_end: "2027-01-01T00:00:00.000Z",
      cancel_at_period_end: true,
    }, config);
    expect(normalized).toMatchObject({ status: "canceled", isEntitled: true, plan: "yearly", accessExpiresAt: "2027-01-01T00:00:00.000Z" });
    expect(effectiveEntitlement(normalized!, new Date("2026-12-31T23:59:59.000Z"))).toBe(true);
    expect(effectiveEntitlement(normalized!, new Date("2027-01-01T00:00:01.000Z"))).toBe(false);
  });

  it("revokes immediately and gives past-due accounts a bounded three-day grace period", () => {
    const base = {
      id: "sub_1", status: "active", customer_id: "cus_1",
      customer: { external_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      product_id: config.monthlyProductId,
      current_period_start: "2026-09-01T00:00:00.000Z",
      current_period_end: "2026-10-01T00:00:00.000Z",
      cancel_at_period_end: false,
    };
    expect(normalizeSubscription("subscription.revoked", "2026-09-11T10:00:00.000Z", base, config)?.isEntitled).toBe(false);
    expect(normalizeSubscription("subscription.past_due", "2026-09-11T10:00:00.000Z", base, config)?.accessExpiresAt).toBe("2026-09-14T10:00:00.000Z");
    expect(normalizeSubscription("subscription.updated", "2026-09-11T10:00:00.000Z", { ...base, status: "past_due" }, config)?.accessExpiresAt).toBe("2026-09-14T10:00:00.000Z");
  });

  it("rejects an oversized body before signature validation", async () => {
    const d = deps();
    const response = await handlePolarWebhook(new Request("https://capture.test/api/webhooks/polar", {
      method: "POST",
      headers: {
        "content-length": "1000001",
        "webhook-id": "evt_large",
        "webhook-signature": "v1,test",
        "webhook-timestamp": "1789120800",
      },
      body: "{}",
    }), d);
    expect(response.status).toBe(413);
    expect(d.validateWebhook).not.toHaveBeenCalled();
  });
});
