import { beforeEach, expect, it, vi } from "vitest";
import { handlePolarWebhook, type AppliedSubscription } from "./polar";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), get: vi.fn(), validate: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@polar-sh/sdk/2026-04", () => ({ createPolar: () => ({ subscriptions: { get: mocks.get } }), webhooks: { validateEvent: mocks.validate } }));
vi.mock("@/lib/supabase/config", () => ({ getCloudConfig: () => ({ status: "ready", url: "https://synthetic.test" }) }));
vi.mock("@/lib/supabase/server", () => ({ createCloudServerClient: vi.fn() }));
import { createPolarDependencies, retryPolarSubscriptionsForUser } from "./polarServer";
const user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const product = "11111111-1111-4111-8111-111111111111";
const env = { CAPTURE_CLOUD: "1", POLAR_ENVIRONMENT: "sandbox", POLAR_ACCESS_TOKEN: "synthetic-unused", SUPABASE_SECRET_KEY: "sb_secret_synthetic-unused", POLAR_WEBHOOK_SECRET: "synthetic-unused", POLAR_PRODUCT_ID_MONTHLY: product, POLAR_PRODUCT_ID_YEARLY: "22222222-2222-4222-8222-222222222222" };
const snapshot = { id: "sub_1", customer_id: "cus_1", customer: { external_id: user }, product_id: product, status: "active", cancel_at_period_end: true, current_period_start: "2026-09-01T00:00:00Z", current_period_end: "2026-10-01T00:00:00Z" };
const event: AppliedSubscription = { eventId: "evt_1", eventType: "subscription.revoked", eventCreatedAt: "2026-09-13T00:00:00Z", userId: user, status: "revoked", plan: "monthly", isEntitled: false, polarCustomerId: "cus_1", polarSubscriptionId: "sub_1", polarProductId: product, currentPeriodStart: snapshot.current_period_start, currentPeriodEnd: snapshot.current_period_end, accessExpiresAt: "2026-09-13T00:00:00Z", cancelAtPeriodEnd: false };
let pending: Record<string, unknown>;
let finishResult: boolean;
beforeEach(() => {
  vi.clearAllMocks();
  pending = { pending: true, version: "9", userId: user, customerId: "cus_1", productId: product };
  finishResult = true;
  mocks.get.mockResolvedValue(snapshot);
  mocks.rpc.mockImplementation(async (name: string) => ({
    error: null,
    data: name === "claim_polar_reconciliation" ? pending
      : name === "finish_polar_reconciliation" ? finishResult
        : name === "acquire_capture_external_work" || name === "release_capture_external_work",
  }));
  mocks.validate.mockResolvedValue({ type: "subscription.revoked", timestamp: event.eventCreatedAt, data: snapshot });
});
it.each(["identity", "product"])("queues a tracked terminal invalid %s webhook and keeps invalid GET retryable", async (kind) => {
  const invalid = { ...snapshot, status: "canceled", ...(kind === "identity" ? { customer: null } : { product_id: "off-catalog" }) };
  mocks.validate.mockResolvedValue({ type: "subscription.canceled", timestamp: event.eventCreatedAt, data: invalid });
  mocks.get.mockResolvedValue(invalid);
  mocks.rpc.mockImplementation(async (name: string) => ({
    error: null,
    data: name === "queue_invalid_polar_event" ? true
      : name === "claim_polar_reconciliation" ? pending
        : name === "acquire_capture_external_work" || name === "release_capture_external_work",
  }));
  const response = await handlePolarWebhook(new Request("https://capture.test/api/webhooks/polar", { method: "POST", headers: { "webhook-id": "invalid_terminal" }, body: "{}" }), await createPolarDependencies(env));
  expect(response.status).toBe(500);
  expect(mocks.rpc).toHaveBeenCalledWith("queue_invalid_polar_event", { p_subscription_id: "sub_1", p_event_id: "invalid_terminal", p_event_type: "subscription.canceled", p_event_created_at: event.eventCreatedAt });
  expect(mocks.rpc.mock.calls.some(([name]) => name === "finish_polar_reconciliation")).toBe(false);
});
it.each(["unrelated", "storage failure", "repaired"])("handles invalid webhook %s through real dependency wiring", async (outcome) => {
  mocks.validate.mockResolvedValue({ type: "subscription.canceled", timestamp: event.eventCreatedAt, data: { ...snapshot, customer: null, status: "canceled" } });
  mocks.rpc.mockImplementation(async (name: string) => ({
    error: name === "queue_invalid_polar_event" && outcome === "storage failure" ? { message: "synthetic" } : null,
    data: name === "queue_invalid_polar_event" ? outcome !== "unrelated" : name === "claim_polar_reconciliation" ? pending : true,
  }));
  const deps = await createPolarDependencies(env);
  const deliver = () => handlePolarWebhook(new Request("https://capture.test/api/webhooks/polar", { method: "POST", headers: { "webhook-id": "invalid_retry" }, body: "{}" }), deps);
  expect((await deliver()).status).toBe(outcome === "storage failure" ? 500 : 202);
  if (outcome !== "repaired") expect(mocks.get).not.toHaveBeenCalled();
  else {
    expect(mocks.rpc).toHaveBeenCalledWith("finish_polar_reconciliation", expect.objectContaining({ p_snapshot: expect.objectContaining({ userId: user, polarProductId: product }) }));
    // Retry the same invalid envelope after authoritative resolution: no GET.
    pending = { pending: false };
    expect((await deliver()).status).toBe(202);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  }
});
it("reconciles even a ledgered duplicate using exact bounded GET, preserving scheduled cancellation", async () => {
  const deps = await createPolarDependencies(env);
  await deps.applySubscriptionEvent(event);
  expect(mocks.get).toHaveBeenCalledExactlyOnceWith("sub_1", { timeout: 2 });
  const names = mocks.rpc.mock.calls.map(([name]) => name);
  expect(names.indexOf("acquire_capture_external_work")).toBeLessThan(names.indexOf("finish_polar_reconciliation"));
  expect(names.indexOf("release_capture_external_work")).toBeGreaterThan(names.indexOf("finish_polar_reconciliation"));
  expect(mocks.rpc).toHaveBeenCalledWith("finish_polar_reconciliation", { p_subscription_id: "sub_1", p_version: "9", p_snapshot: expect.objectContaining({ status: "canceled", isEntitled: true, accessExpiresAt: snapshot.current_period_end, cancelAtPeriodEnd: true }) });
});
it.each(["network", "binding", "product", "subscription", "identity", "stale", "busy"])("keeps %s failures pending and returns retryable webhook failure", async (failure) => {
  if (failure === "network") mocks.get.mockRejectedValue(new Error("timeout"));
  if (failure === "binding") mocks.get.mockResolvedValue({ ...snapshot, customer_id: "wrong" });
  if (failure === "product") mocks.get.mockResolvedValue({ ...snapshot, product_id: "33333333-3333-4333-8333-333333333333" });
  if (failure === "subscription") mocks.get.mockResolvedValue({ ...snapshot, id: "wrong" });
  if (failure === "identity") mocks.get.mockResolvedValue({ ...snapshot, customer: { external_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } });
  if (failure === "stale") finishResult = false;
  if (failure === "busy") pending = { pending: true };
  const response = await handlePolarWebhook(new Request("https://capture.test/api/webhooks/polar", { method: "POST", headers: { "webhook-id": "evt_1" }, body: "{}" }), await createPolarDependencies(env));
  expect(response.status).toBe(500);
  if (failure !== "stale") expect(mocks.rpc.mock.calls.some(([name]) => name === "finish_polar_reconciliation")).toBe(false);
  if (failure !== "busy") expect(mocks.rpc.mock.calls.some(([name]) => name === "release_capture_external_work")).toBe(true);
});
it("allows an authoritative switch between the configured Capture products, never an unrelated product", async () => {
  mocks.get.mockResolvedValue({ ...snapshot, product_id: env.POLAR_PRODUCT_ID_YEARLY });
  await (await createPolarDependencies(env)).applySubscriptionEvent(event);
  expect(mocks.rpc).toHaveBeenCalledWith("finish_polar_reconciliation", expect.objectContaining({ p_snapshot: expect.objectContaining({ polarProductId: env.POLAR_PRODUCT_ID_YEARLY, plan: "yearly" }) }));
});
it.each([undefined, null, "malformed"])("retains retry when authoritative past-due anchor is %s", async (past_due_at) => {
  mocks.get.mockResolvedValue({ ...snapshot, status: "past_due", past_due_at });
  await expect((await createPolarDependencies(env)).applySubscriptionEvent(event)).rejects.toThrow();
  expect(mocks.rpc.mock.calls.some(([name]) => name === "finish_polar_reconciliation")).toBe(false);
});
it("recovers one due subscription from the owner-scoped durable queue without replaying a webhook", async () => {
  mocks.rpc.mockResolvedValueOnce({ error: null, data: "sub_1" });
  await retryPolarSubscriptionsForUser(user, env);
  expect(mocks.rpc).toHaveBeenCalledWith("next_polar_reconciliation", { p_user_id: user });
  expect(mocks.get).toHaveBeenCalledExactlyOnceWith("sub_1", { timeout: 2 });
  expect(mocks.rpc.mock.calls.some(([name]) => name === "apply_polar_subscription_event")).toBe(false);
});
it("never fetches provider state for an unambiguous or already resolved subscription", async () => {
  pending = { pending: false };
  await (await createPolarDependencies(env)).applySubscriptionEvent(event);
  expect(mocks.get).not.toHaveBeenCalled();
});
