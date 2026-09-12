import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260911170000_polar_entitlements.sql"),
  "utf8",
).toLowerCase();

describe("Polar entitlement migration contract", () => {
  it("keeps customer entitlements tenant-readable and server-owned", () => {
    for (const clause of [
      "create table if not exists public.capture_cloud_subscriptions",
      "polar_subscription_id text primary key",
      "user_id uuid not null references auth.users(id) on delete cascade",
      "capture_cloud_subscriptions_user_id_idx",
      "enable row level security",
      "grant select on table public.capture_cloud_subscriptions to authenticated",
      "create policy capture_cloud_subscriptions_select",
      "using ((select auth.uid()) = user_id)",
      "revoke insert, update, delete on table public.capture_cloud_subscriptions from anon, authenticated",
    ]) expect(sql).toContain(clause);
  });

  it("stores webhook receipts privately and applies each event atomically", () => {
    for (const clause of [
      "create table if not exists public.polar_webhook_events",
      "event_id text primary key",
      "enable row level security",
      "revoke all on table public.polar_webhook_events from anon, authenticated",
      "create or replace function public.apply_polar_subscription_event",
      "on conflict (event_id) do nothing",
      "if not found then",
      "on conflict (polar_subscription_id) do update",
      "polar subscription ownership mismatch",
      "capture_cloud_subscriptions.last_event_at < excluded.last_event_at",
      "grant execute on function public.apply_polar_subscription_event",
      "to service_role",
    ]) expect(sql).toContain(clause);
  });
});
