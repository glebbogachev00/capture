import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260922400000_complimentary_cloud_access.sql",
);
const sql = () => readFileSync(migrationPath, "utf8").toLowerCase();

describe("complimentary Capture Cloud migration", () => {
  it("stores UUID-keyed service-managed grants with expiry and revocation metadata", () => {
    const source = sql();
    expect(source).toContain("create table if not exists public.capture_cloud_complimentary_grants");
    expect(source).toContain("user_id uuid primary key references auth.users(id) on delete cascade");
    expect(source).toContain("expires_at timestamptz");
    expect(source).toContain("revoked_at timestamptz");
    expect(source).toContain("revoke all on table public.capture_cloud_complimentary_grants from public, anon, authenticated");
    expect(source).toContain("grant select, insert, update, delete on table public.capture_cloud_complimentary_grants to service_role");
  });

  it("defines one exact-owner fail-closed predicate for paid or complimentary access", () => {
    const source = sql();
    expect(source).toContain("create or replace function public.capture_cloud_access_current(p_user_id uuid)");
    expect(source).toMatch(/capture_cloud_subscriptions[\s\S]*is_entitled[\s\S]*access_expires_at > statement_timestamp\(\)/);
    expect(source).toMatch(/capture_cloud_complimentary_grants[\s\S]*revoked_at is null[\s\S]*expires_at is null/);
    expect(source).toContain("exact owner required");
    expect(source).toContain("grant execute on function public.capture_cloud_access_current(uuid) to authenticated, service_role");
    expect(source).toContain("create or replace function public.capture_cloud_complimentary_grant_status(p_user_id uuid)");
    expect(source).toContain("jsonb_build_object('current',v_current,'expiresat',v_expires_at)");
  });

  it("moves final image write policies and storage admission onto the canonical predicate", () => {
    const source = sql();
    for (const policy of [
      "capture_image_publication_owner_insert",
      "capture_images_write_entitlement",
      "capture_candidates_write_entitlement",
      "capture_fresh_write_entitlement",
    ]) expect(source).toContain(`create policy ${policy}`);
    expect(source.match(/public\.capture_cloud_access_current\(/g)?.length).toBeGreaterThanOrEqual(6);
    expect(source).toContain("create or replace function public.reserve_capture_image_storage");
    expect(source).toContain("create or replace function public.finalize_capture_image_storage");
  });

  it("keeps recovery reads but gates every direct board mutation on current Cloud access", () => {
    const source = sql();
    for (const operation of ["insert", "update", "delete"]) {
      expect(source).toContain(`create policy capture_boards_cloud_access_${operation}`);
    }
    expect(source).toContain("as restrictive for insert to authenticated");
    expect(source).toContain("as restrictive for update to authenticated");
    expect(source).toContain("as restrictive for delete to authenticated");
    expect(source).not.toContain("capture_boards_cloud_access_select");
  });

  it("revokes grants at erasure confirmation and removes them in app-row cleanup", () => {
    const source = sql();
    expect(source).toContain("capture_complimentary_grant_erasure_fence");
    expect(source).toContain("delete from public.capture_cloud_complimentary_grants where user_id=p_owner_id");
    expect(source).toContain("exists(select 1 from public.capture_cloud_complimentary_grants where user_id=p_owner_id)");
  });
});