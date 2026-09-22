import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = "supabase/migrations/20260922300000_operational_retention.sql";
const sql = () => readFileSync(path, "utf8").toLowerCase();

describe("operational retention migration contract", () => {
  it("is additive, service-only, bounded, locked, and idempotent", () => {
    const source = sql();
    expect(source).toContain("create table if not exists public.capture_operational_maintenance");
    expect(source).toContain("pg_try_advisory_xact_lock");
    expect(source).toContain("for update skip locked");
    expect(source).toContain("for update nowait");
    expect(source).toMatch(/limit\s+100/);
    expect(source).toContain("create or replace function public.run_capture_operational_maintenance");
    expect(source).toContain("revoke all on function public.run_capture_operational_maintenance");
    expect(source).toContain("grant execute on function public.run_capture_operational_maintenance");
    expect(source).not.toMatch(/grant execute[^;]+authenticated/);
  });

  it("cleans every approved operational class without touching live obligations or inventory", () => {
    const source = sql();
    for (const table of [
      "capture_boards",
      "capture_cloud_owner_quotas",
      "polar_webhook_events",
      "capture_external_work_admissions",
      "capture_external_capabilities",
      "capture_image_operations",
      "capture_account_erasure_operations",
    ]) expect(source).toContain(table);
    expect(source).toContain("interval '30 days'");
    expect(source).toContain("interval '7 days'");
    expect(source).toContain("interval '400 days'");
    expect(source).toContain("state in ('released','deleted')");
    expect(source).not.toMatch(/delete from public\.capture_image_publications/);
    expect(source).not.toMatch(/delete from public\.capture_cloud_subscriptions/);
    expect(source).not.toMatch(/delete from public\.capture_image_owner_usage/);
    expect(source).not.toMatch(/reconciliation_required\s*=\s*true[^;]*delete/);
  });

  it("preserves authoritative webhook ties, interleaves cleanup owners, and never blocks on owner locks", () => {
    const source = sql();
    expect(source).toContain("event.event_created_at is distinct from subscription.last_event_at");
    expect(source.match(/pg_try_advisory_xact_lock/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source.match(/partition by owner_id/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source.match(/order by owner_rank/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).not.toContain("perform public.capture_account_owner_lock(row_record.owner_id)");
  });

  it("preserves durable erasure evidence before expiring receipt rows", () => {
    const source = sql();
    expect(source).toContain("create table if not exists public.capture_account_erasure_evidence");
    expect(source).toContain("capture_account_erasure_evidence_guard_fn");
    expect(source).toContain("before update or delete");
    expect(source).toContain("stage='complete'");
    expect(source).toContain("receipt_expires_at <=");
    expect(source).not.toMatch(/delete from public\.capture_account_erasure_evidence/);
  });

  it("reports only fixed aggregate health states", () => {
    const source = sql();
    expect(source).toContain("create or replace function public.capture_operational_health");
    for (const signal of [
      "overdueerasures",
      "billingreconciliation",
      "webhookdelivery",
      "imagepressure",
      "quotapressure",
      "readinessdrift",
      "maintenance",
    ]) expect(source).toContain(`'${signal}'`);
    expect(source).toMatch(/'ok'|'warning'|'critical'|'unknown'/);
    expect(source).not.toContain("ownerid");
    expect(source).not.toContain("userid");
  });
});
