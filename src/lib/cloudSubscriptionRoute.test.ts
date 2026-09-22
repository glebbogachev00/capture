import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CloudSubscriptionRow } from "./cloudSubscription";

const state = vi.hoisted(() => ({
  rows: [] as (CloudSubscriptionRow & { user_id: string })[],
  retry: vi.fn().mockResolvedValue(undefined),
  erasing: false,
  complimentary: false,
  complimentaryExpiresAt: null as string | null,
  rpc: vi.fn(),
}));
vi.mock("@/lib/polarServer", () => ({ retryPolarSubscriptionsForUser: state.retry }));
vi.mock("@/lib/cloudBoard", () => ({ isCloudEnabled: () => true }));
vi.mock("@/lib/supabase/config", () => ({ getCloudConfig: () => ({ status: "ready" }) }));
vi.mock("@/lib/supabase/identity", () => ({ identityFromClaims: async () => ({ userId: "owner" }) }));
vi.mock("@/lib/supabase/server", () => ({
  createCloudServerClient: async () => ({ rpc: state.rpc, from: () => {
    let rows = [...state.rows];
    const query = {
      select: () => query,
      eq: (key: keyof typeof rows[number], value: unknown) => { rows = rows.filter(r => r[key] === value); return query; },
      gt: (key: keyof typeof rows[number], value: string) => { rows = rows.filter(r => String(r[key]) > value); return query; },
      order: (key: keyof typeof rows[number], options: { ascending: boolean }) => {
        rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (options.ascending ? 1 : -1));
        return query;
      },
      limit: (count: number) => { rows = rows.slice(0, count); return query; },
      then: (resolve: (result: { data: typeof rows; error: null }) => unknown) => Promise.resolve(resolve({ data: rows, error: null })),
    };
    return query;
  } }),
}));
import { GET } from "@/app/api/cloud/subscription/route";

beforeEach(() => {
  state.retry.mockReset().mockResolvedValue(undefined);
  state.erasing = false;
  state.complimentary = false;
  state.complimentaryExpiresAt = null;
  state.rpc.mockReset().mockImplementation(async (name: string) => ({
    data: name === "capture_account_deleting"
      ? state.erasing
      : name === "capture_cloud_access_current"
        ? state.complimentary || state.rows.some((row) => row.user_id === "owner" && row.is_entitled && Date.parse(row.access_expires_at ?? "") > Date.now())
        : name === "capture_cloud_complimentary_grant_status"
          ? { current: state.complimentary, expiresAt: state.complimentaryExpiresAt }
          : null,
    error: null,
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it("retries durable pending reconciliation for only the verified owner, even after webhook retries end", async () => {
  vi.stubEnv("CAPTURE_CLOUD", "1");
  state.rows = [];
  state.retry.mockRejectedValueOnce(new Error("provider unavailable"));
  const response = await GET(new Request("https://capture.test/api/cloud/subscription?userId=attacker"));
  expect(state.retry).toHaveBeenCalledWith("owner");
  expect(await response.json()).toMatchObject({ tier: "free" });
});

it("checks the account lifecycle before retrying Polar or reading subscription rows", async () => {
  vi.stubEnv("CAPTURE_CLOUD", "1");
  state.erasing = true;
  state.rows = [{
    user_id: "owner", status: "active", plan: "monthly", is_entitled: true,
    current_period_end: "2099-01-01T00:00:00Z", access_expires_at: "2099-01-01T00:00:00Z",
    cancel_at_period_end: false, last_event_at: "2026-09-13T00:00:00Z",
  }];
  const response = await GET(new Request("https://capture.test/api/cloud/subscription"));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "account unavailable" });
  expect(state.rpc).toHaveBeenCalledWith("capture_account_deleting", { p_user_id: "owner" });
  expect(state.retry).not.toHaveBeenCalled();
});

it("surfaces older pending billing instead of a newer inactive row and retries only its owner", async () => {
  vi.stubEnv("CAPTURE_CLOUD", "1");
  const row = { user_id: "owner", status: "revoked", plan: "monthly", is_entitled: false, current_period_end: "2026-01-01T00:00:00Z", access_expires_at: "2026-01-01T00:00:00Z", cancel_at_period_end: false, last_event_at: "2026-09-13T00:00:00Z" };
  state.rows = [row, { ...row, status: "active", last_event_at: "2026-01-01T00:00:00Z", reconciliation_required: true } as typeof state.rows[number]];
  state.retry.mockRejectedValueOnce(new Error("still invalid"));
  expect(await (await GET(new Request("https://capture.test/api/cloud/subscription"))).json()).toMatchObject({ tier: "free", reconciliationRequired: true });
  expect(state.retry).toHaveBeenCalledWith("owner");
});
it("finds the owner's current entitlement beyond twenty newer inactive subscriptions", async () => {
  vi.stubEnv("CAPTURE_CLOUD", "1");
  const inactive = { user_id: "owner", status: "revoked", plan: "monthly", is_entitled: false,
    current_period_end: "2099-01-01T00:00:00Z", access_expires_at: "2020-01-01T00:00:00Z",
    cancel_at_period_end: false, last_event_at: "2026-09-13T00:00:00Z" };
  state.rows = [
    ...Array.from({ length: 25 }, () => ({ ...inactive })),
    { ...inactive, status: "active", is_entitled: true, access_expires_at: "2099-01-01T00:00:00Z", last_event_at: "2026-01-01T00:00:00Z" },
  ];
  expect(await (await GET(new Request("https://capture.test/api/cloud/subscription"))).json()).toMatchObject({ tier: "cloud", captureLimit: null });
});

it("reports a service-managed complimentary grant without a Polar subscription", async () => {
  vi.stubEnv("CAPTURE_CLOUD", "1");
  state.rows = [];
  state.complimentary = true;
  state.complimentaryExpiresAt = "2099-01-01T00:00:00Z";
  const response = await GET(new Request("https://capture.test/api/cloud/subscription"));
  expect(await response.json()).toMatchObject({
    tier: "cloud",
    accessSource: "complimentary",
    plan: null,
    canManageBilling: false,
    captureLimit: null,
  });
});

it("falls back to the latest inactive subscription without borrowing another owner's access", async () => {
  vi.stubEnv("CAPTURE_CLOUD", "1");
  state.rows = [
    { user_id: "other", status: "active", plan: "yearly", is_entitled: true, current_period_end: "2099-01-01T00:00:00Z", access_expires_at: "2099-01-01T00:00:00Z", cancel_at_period_end: false, last_event_at: "2026-09-13T00:00:00Z" },
    { user_id: "owner", status: "revoked", plan: "monthly", is_entitled: false, current_period_end: "2026-01-01T00:00:00Z", access_expires_at: "2026-01-01T00:00:00Z", cancel_at_period_end: false, last_event_at: "2026-01-01T00:00:00Z" },
  ];
  expect(await (await GET(new Request("https://capture.test/api/cloud/subscription"))).json()).toMatchObject({ tier: "free", status: "revoked", plan: "monthly" });
});
