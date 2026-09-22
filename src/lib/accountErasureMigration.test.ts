import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = "supabase/migrations/20260922100000_account_erasure.sql";
const migration = () => readFileSync(path, "utf8").toLowerCase();

describe("account erasure SQL contract (static; hosted execution remains gated)", () => {
  it("keeps a service-only, non-cascading, content-free durable operation ledger", () => {
    const sql = migration();
    const table = sql.slice(
      sql.indexOf("create table if not exists public.capture_account_erasure_operations"),
      sql.indexOf(");", sql.indexOf("create table if not exists public.capture_account_erasure_operations")) + 2,
    );
    for (const clause of [
      "create table if not exists public.capture_account_erasure_operations",
      "operation_id uuid primary key",
      "owner_id uuid,",
      "receipt_secret_hash text not null",
      "session_id_hash text",
      "stage text not null",
      "lease_id uuid",
      "lease_expires_at timestamptz",
      "version bigint not null",
      "attempt_count integer not null",
      "retry_count integer not null",
      "retry_after timestamptz",
      "last_error_code text",
      "completed_at timestamptz",
      "receipt_expires_at timestamptz not null",
      "enable row level security",
      "revoke all on table public.capture_account_erasure_operations from public, anon, authenticated",
    ]) expect(sql).toContain(clause);
    expect(table).not.toContain("references auth.users");
    expect(sql).not.toMatch(/on delete cascade[^;]*capture_account_erasure_operations/);
    expect(table).not.toMatch(/\b(email|payload|content|message|object_name)\b/);
  });

  it("atomically confirms the deletion fence and denies entitlement restoration", () => {
    const sql = migration();
    for (const clause of [
      "create or replace function public.confirm_capture_account_erasure",
      "for update",
      "stage = 'polar'",
      "confirmed_at = v_now",
      "is_entitled = false",
      "create or replace function public.capture_account_deleting",
      "capture_account_write_allowed(p_user_id)",
      "insert into public.polar_webhook_events",
      "if not public.capture_account_write_allowed(p_user_id) then",
      "return true",
    ]) expect(sql).toContain(clause);
  });

  it("allows exact-owner reads only while prepared and fences every read after confirmation", () => {
    const sql = migration();
    for (const clause of [
      "create policy capture_boards_insert",
      "create policy capture_boards_update",
      "create policy capture_boards_delete",
      "capture_account_write_allowed((select auth.uid()))",
      "create or replace function public.capture_account_write_allowed",
      "create or replace function public.capture_account_read_allowed",
      "for share",
      "create policy capture_image_publication_erasure_fence",
      "create policy capture_images_write_erasure_fence",
      "create policy capture_candidates_write_erasure_fence",
      "create policy capture_fresh_write_erasure_fence",
      "set policy_fingerprint = public.capture_image_fresh_policy_fingerprint()",
      "create trigger capture_image_fresh_fixed",
      "consume_capture_cloud_quota",
      "claim_polar_reconciliation",
      "finish_polar_reconciliation",
      "queue_invalid_polar_event",
      "create policy capture_boards_erasure_read_fence",
      "create policy capture_cloud_subscriptions_erasure_read_fence",
      "create policy capture_image_publication_erasure_read_fence",
      "create policy capture_storage_erasure_read_fence",
    ]) expect(sql).toContain(clause);
  });

  it("uses versioned leases, bounded content-free receipts, and service-only worker RPCs", () => {
    const sql = migration();
    for (const clause of [
      "prepare_capture_account_erasure",
      "status_capture_account_erasure",
      "claim_capture_account_erasure",
      "advance_capture_account_erasure",
      "fail_capture_account_erasure",
      "cleanup_capture_account_erasure_receipts",
      "for update skip locked",
      "delete from public.capture_account_erasure_operations operation",
      "operation.stage in ('prepared','complete')",
      "operation.receipt_expires_at <= clock_timestamp()",
      "lease_expires_at <= p_now",
      "receipt_expires_at <= clock_timestamp()",
      "interval '30 days'",
      "to service_role",
    ]) expect(sql).toContain(clause);
    for (const rpc of ["prepare", "status", "confirm", "claim", "advance", "fail"]) {
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${rpc}_capture_account_erasure\\([^;]+to service_role`));
      expect(sql).not.toMatch(new RegExp(`grant execute on function public\\.${rpc}_capture_account_erasure\\([^;]+to authenticated`));
    }
  });

  it("defines durable owner-bound external admissions and conservative Polar capabilities", () => {
    const sql = migration();
    for (const clause of [
      "capture_external_work_admissions",
      "capture_external_capabilities",
      "acquire_capture_external_work",
      "release_capture_external_work",
      "capture_external_work_active",
      "p_capability_expires_at",
      "external work active",
      "unexpired external capability",
    ]) expect(sql).toContain(clause);
  });

  it("provides idempotent app-row delete/readback without touching the erasure receipt", () => {
    const sql = migration();
    const deletion = sql.slice(
      sql.indexOf("create or replace function public.delete_capture_account_app_rows"),
      sql.indexOf("create or replace function public.capture_account_app_rows_exist"),
    );
    expect(sql).toContain("delete_capture_account_app_rows");
    expect(sql).toContain("capture_account_app_rows_exist");
    for (const table of [
      "capture_boards", "capture_image_publications", "capture_cloud_owner_quotas",
      "capture_cloud_subscriptions", "capture_image_operations", "capture_image_owner_usage",
    ]) expect(deletion).toContain(`delete from public.${table}`);
    expect(deletion).not.toContain("delete from public.capture_account_erasure_operations");
  });

  it("uses a read-backable durable fence as session authority before Auth deletion", () => {
    const sql = migration();
    expect(sql).toContain("establish_capture_account_session_fence");
    expect(sql).toContain("capture_account_session_fence_authoritative");
    expect(sql).toContain("stage in ('sessions','storage','app_rows','auth')");
  });
});
