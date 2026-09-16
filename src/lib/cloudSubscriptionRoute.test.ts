import { afterEach, expect, it, vi } from "vitest";
import type { CloudSubscriptionRow } from "./cloudSubscription";

const state = vi.hoisted(() => ({ rows: [] as (CloudSubscriptionRow & { user_id: string })[], retry: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/polarServer", () => ({ retryPolarSubscriptionsForUser: state.retry }));
vi.mock("@/lib/cloudBoard", () => ({ isCloudEnabled: () => true }));
vi.mock("@/lib/supabase/config", () => ({ getCloudConfig: () => ({ status: "ready" }) }));
vi.mock("@/lib/supabase/identity", () => ({ identityFromClaims: async () => ({ userId: "owner" }) }));
vi.mock("@/lib/supabase/server", () => ({
  createCloudServerClient: async () => ({ from: () => {
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

afterEach(() => { vi.unstubAllEnvs(); state.retry.mockReset().mockResolvedValue(undefined); });

it("retries durable pending reconciliation for only the verified owner, even after webhook retries end", async () => {
  vi.stubEnv("CAPTURE_CLOUD", "1");
  state.rows = [];
  state.retry.mockRejectedValueOnce(new Error("provider unavailable"));
  const response = await GET(new Request("https://capture.test/api/cloud/subscription?userId=attacker"));
  expect(state.retry).toHaveBeenCalledWith("owner");
  expect(await response.json()).toMatchObject({ tier: "free" });
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

it("falls back to the latest inactive subscription without borrowing another owner's access", async () => {
  vi.stubEnv("CAPTURE_CLOUD", "1");
  state.rows = [
    { user_id: "other", status: "active", plan: "yearly", is_entitled: true, current_period_end: "2099-01-01T00:00:00Z", access_expires_at: "2099-01-01T00:00:00Z", cancel_at_period_end: false, last_event_at: "2026-09-13T00:00:00Z" },
    { user_id: "owner", status: "revoked", plan: "monthly", is_entitled: false, current_period_end: "2026-01-01T00:00:00Z", access_expires_at: "2026-01-01T00:00:00Z", cancel_at_period_end: false, last_event_at: "2026-01-01T00:00:00Z" },
  ];
  expect(await (await GET(new Request("https://capture.test/api/cloud/subscription"))).json()).toMatchObject({ tier: "free", status: "revoked", plan: "monthly" });
});
