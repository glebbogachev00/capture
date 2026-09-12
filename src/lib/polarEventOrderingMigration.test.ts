import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const original = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260911170000_polar_entitlements.sql"),
  "utf8",
).toLowerCase();
const amendment = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260912162000_polar_event_ordering.sql"),
  "utf8",
).toLowerCase();

describe("Polar event ordering migration", () => {
  it("never lets a distinct equal-timestamp delivery overwrite accepted state", () => {
    expect(original).toContain("capture_cloud_subscriptions.last_event_at < excluded.last_event_at");
    expect(original).not.toContain("capture_cloud_subscriptions.last_event_at <= excluded.last_event_at");
    expect(amendment).toContain("create or replace function public.apply_polar_subscription_event");
    expect(amendment).toContain("capture_cloud_subscriptions.last_event_at < excluded.last_event_at");
    expect(amendment).not.toContain("capture_cloud_subscriptions.last_event_at <= excluded.last_event_at");
  });

  it("keeps the replacement function private to the service role", () => {
    expect(amendment).toContain("security definer");
    expect(amendment).toContain("set search_path = ''");
    expect(amendment).toContain("revoke all on function public.apply_polar_subscription_event");
    expect(amendment).toContain("to service_role");
  });
});
