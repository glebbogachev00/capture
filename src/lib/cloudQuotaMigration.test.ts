import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260921200000_cloud_owner_quotas.sql"), "utf8").toLowerCase();

describe("durable Cloud owner quota migration", () => {
  it("stores one bounded atomic counter per authenticated owner and scope", () => {
    for (const clause of [
      "create table if not exists public.capture_cloud_owner_quotas",
      "user_id uuid not null references auth.users(id) on delete cascade",
      "primary key (user_id, scope)",
      "create table if not exists public.capture_cloud_quota_policies",
      "request_limit integer not null",
      "window_seconds integer not null",
      "create or replace function public.consume_capture_cloud_quota",
      "auth.uid()",
      "on conflict (user_id, scope) do update",
      "request_count < v_limit",
      "security definer",
      "set search_path = ''",
      "revoke all on table public.capture_cloud_owner_quotas from public, anon, authenticated",
      "revoke all on table public.capture_cloud_quota_policies from public, anon, authenticated",
      "drop function if exists public.consume_capture_cloud_quota(text, integer, integer)",
      "revoke all on function public.consume_capture_cloud_quota(text) from public, anon",
      "grant execute on function public.consume_capture_cloud_quota(text) to authenticated",
    ]) expect(sql).toContain(clause);
  });

  it("owns limits and windows inside PostgreSQL rather than trusting callers", () => {
    expect(sql).toMatch(/where policy\.scope\s*=\s*p_scope/);
    expect(sql).not.toMatch(/p_limit\s+integer/);
    expect(sql).not.toMatch(/p_window_seconds\s+integer/);
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete|all).*capture_cloud_owner_quotas.*authenticated/);
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete|all).*capture_cloud_quota_policies.*authenticated/);
  });
});
