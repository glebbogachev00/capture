import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { webhooks } from "@polar-sh/sdk/2026-04";
import { handlePolarWebhook, type PolarDependencies } from "./polar";

// Public, synthetic test material. Not a dashboard secret or a credential.
const key = Buffer.from("capture-test-only-signature-key-32");
const secret = `whsec_${key.toString("base64")}`;
const product = "11111111-1111-4111-8111-111111111111";
const user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const payload = {
  type: "subscription.active", api_version: "2026-04", timestamp: "2026-09-13T00:00:00Z",
  data: {
    id: "test_subscription", status: "active", customer_id: "test_customer",
    customer: { external_id: user, name: "Synthetic café 🧪" }, product_id: product,
    current_period_start: "2026-09-01T00:00:00Z", current_period_end: "2026-10-01T00:00:00Z",
    cancel_at_period_end: false,
  },
};
// Whitespace + non-ASCII deliberately exercise byte-preserving signature validation.
const body = JSON.stringify(payload, null, 2) + "\n";

function fixture(scheme: "standard" | "legacy") {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const id = "test_event_signature";
  const signature = createHmac("sha256", scheme === "standard" ? key : Buffer.from(secret))
    .update(`${id}.${timestamp}.${body}`).digest("base64");
  const headers: Record<string, string> = {
    "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}`,
  };
  const apply = vi.fn().mockResolvedValue(true);
  const deps: PolarDependencies = {
    config: { environment: "sandbox", accessToken: "synthetic-unused", webhookSecret: secret,
      monthlyProductId: product, yearlyProductId: "22222222-2222-4222-8222-222222222222", siteUrl: "https://capture.test" },
    isCloudEnabled: () => true, identity: async () => null, isAccountErasing: async () => false,
    hasBlockingSubscription: async () => false,
    acquireExternalWork: async () => { throw new Error("No network allowed"); },
    releaseExternalWork: async () => { throw new Error("No network allowed"); },
    createCheckout: async () => { throw new Error("No network allowed"); },
    createCustomerSession: async () => { throw new Error("No network allowed"); },
    validateWebhook: webhooks.validateEvent,
    queueInvalidSubscriptionEvent: async () => {},
    applySubscriptionEvent: apply,
  };
  return { headers, deps, apply };
}

for (const scheme of ["standard", "legacy"] as const) {
  describe(`installed Polar SDK ${scheme} signatures`, () => {
    it("accepts a real HMAC on the unmodified raw body and applies the bound identity", async () => {
      const f = fixture(scheme);
      const response = await handlePolarWebhook(new Request("https://capture.test/api/webhooks/polar", { method: "POST", headers: f.headers, body }), f.deps);
      expect(response.status).toBe(202);
      expect(f.apply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ userId: user, eventId: f.headers["webhook-id"], isEntitled: true }));
    });
    it.each(["body", "webhook-id", "webhook-timestamp", "webhook-signature"])("rejects tampered %s before any subscription write", async (field) => {
      const f = fixture(scheme);
      const tamperedBody = field === "body" ? body.replace("active", "revoked") : body;
      if (field !== "body") f.headers[field] += "tampered";
      const response = await handlePolarWebhook(new Request("https://capture.test/api/webhooks/polar", { method: "POST", headers: f.headers, body: tamperedBody }), f.deps);
      expect(response.status).toBe(403);
      expect(f.apply).not.toHaveBeenCalled();
    });
    it("rejects reserialized JSON even though its parsed data is identical", async () => {
      const f = fixture(scheme);
      const response = await handlePolarWebhook(new Request("https://capture.test/api/webhooks/polar", { method: "POST", headers: f.headers, body: JSON.stringify(payload) }), f.deps);
      expect(response.status).toBe(403);
      expect(f.apply).not.toHaveBeenCalled();
    });
  });
}
