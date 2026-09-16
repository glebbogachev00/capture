import { afterEach, expect, it, vi } from "vitest";
import { handleCheckout, handleCustomerPortal } from "./polar";
const mocks = vi.hoisted(() => ({ checkout: vi.fn(), portal: vi.fn() }));
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
vi.mock("@polar-sh/sdk/2026-04", () => ({ createPolar: () => ({ checkouts: { create: mocks.checkout }, customerSessions: { create: mocks.portal } }), webhooks: {} }));
vi.mock("@/lib/supabase/config", () => ({ getCloudConfig: () => ({ status: "ready", url: "https://synthetic.test" }) }));
vi.mock("@/lib/supabase/server", () => ({ createCloudServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "synthetic@example.test" } }, error: null }) } }) }));
import { createPolarDependencies } from "./polarServer";
const env = { CAPTURE_CLOUD: "1", POLAR_ENVIRONMENT: "sandbox", POLAR_ACCESS_TOKEN: "synthetic-unused", SUPABASE_SECRET_KEY: "sb_secret_synthetic-unused", POLAR_PRODUCT_ID_MONTHLY: "11111111-1111-4111-8111-111111111111", POLAR_PRODUCT_ID_YEARLY: "22222222-2222-4222-8222-222222222222" };
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("blocks checkout for denied pending billing using real dependencies and Supabase request wiring; portal remains available", async () => {
  const urls: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    expect(url.origin).toBe("https://synthetic.test"); // never forward any request
    urls.push(url);
    expect(url.searchParams.get("user_id")).toBe(`eq.${owner}`);
    // Synthetic pending source: is_entitled=false, expiry in the past. The
    // previous effective-access-only query incorrectly filters this row out.
    const includesPending = url.searchParams.get("or")?.includes("reconciliation_required.eq.true");
    return Response.json(includesPending ? [{ polar_subscription_id: "pending_charging" }] : []);
  }));
  mocks.checkout.mockResolvedValue({ url: "https://synthetic.test/should-not-create" });
  mocks.portal.mockResolvedValue({ customer_portal_url: "https://synthetic.test/manage" });
  const deps = await createPolarDependencies(env);
  const response = await handleCheckout(new Request("https://capture.test/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan: "monthly" }) }), deps);
  expect(response.status).toBe(409);
  expect(mocks.checkout).not.toHaveBeenCalled();
  expect(urls).toHaveLength(1);
  expect(urls[0].searchParams.get("or")).toMatch(/^\(reconciliation_required.eq.true,and\(is_entitled.eq.true,access_expires_at.gt\..+\)\)$/);
  expect(urls[0].searchParams.has("is_entitled")).toBe(false);
  const portal = await handleCustomerPortal(new Request("https://capture.test/api/billing/portal"), deps);
  expect(portal.status).toBe(200);
  expect(mocks.portal).toHaveBeenCalledWith({ external_customer_id: owner, return_url: "https://trycapture.app/app" });
});
