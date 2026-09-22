import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = "supabase/migrations/20260922200000_image_storage_admissions.sql";
const migration = () => readFileSync(path, "utf8").toLowerCase();
const verification = () => readFileSync("supabase/verify-image-storage-admissions.sql", "utf8").toLowerCase();

describe("Cloud image storage admission migration", () => {
  it("owns bounded object and byte limits in service-only PostgreSQL state", () => {
    const sql = migration();
    for (const clause of [
      "create table public.capture_image_storage_policy",
      "max_objects integer not null",
      "max_bytes bigint not null",
      "max_object_bytes integer not null",
      "lease_seconds integer not null",
      "create table public.capture_image_owner_usage",
      "reserved_objects integer not null",
      "reserved_bytes bigint not null",
      "create table public.capture_image_operations",
      "operation_version bigint not null default 0",
      "object_path text generated always as",
      "revoke all on table public.capture_image_storage_policy from public, anon, authenticated",
      "revoke all on table public.capture_image_owner_usage from public, anon, authenticated",
      "revoke all on table public.capture_image_operations from public, anon, authenticated",
    ]) expect(sql).toContain(clause);
    expect(sql).toContain("values (true, 256, 576000000, 2250000, 120)");
  });

  it("reserves atomically from server-owned policy and generated candidate paths", () => {
    const sql = migration();
    for (const clause of [
      "create function public.reserve_capture_image_storage",
      "public.capture_account_owner_lock(p_owner_id)",
      "public.capture_account_write_allowed(p_owner_id)",
      "capture_image_publication_config()",
      "on conflict(owner_id) do update",
      "usage.reserved_objects + 1 <= policy.max_objects",
      "usage.reserved_bytes + p_byte_size <= policy.max_bytes",
      "gen_random_uuid()",
      "'image_upload'",
      "grant execute on function public.reserve_capture_image_storage",
      "to service_role",
    ]) expect(sql).toContain(clause);
    expect(sql).not.toMatch(/reserve_capture_image_storage\([^)]*(max_objects|max_bytes|max_object_bytes)/);
    expect(sql).not.toMatch(/grant execute on function public\.reserve_capture_image_storage[^;]+to authenticated/);
  });

  it("makes upload recording, finalize, and safe pre-upload release idempotent", () => {
    const sql = migration();
    for (const clause of [
      "record_capture_image_storage_upload",
      "finalize_capture_image_storage",
      "release_capture_image_storage_reservation",
      "abandon_capture_image_storage_reservation",
      "state in ('published','abandoned')",
      "on conflict (user_id,image_id) do nothing",
      "capture.image_operation_id",
      "delete from public.capture_external_work_admissions",
      "state='released'",
      "reserved_objects=usage.reserved_objects-1",
      "reserved_bytes=usage.reserved_bytes-operation.byte_size",
      "reconciliation_lease_id=null",
      "operation_version=operation_version+1",
    ]) expect(sql).toContain(clause);
  });

  it("closes direct authenticated candidate and publication insertion", () => {
    const sql = migration();
    expect(sql).toContain("revoke insert on public.capture_image_publications from authenticated");
    expect(sql).toContain("create policy capture_image_app_only_insert on storage.objects");
    expect(sql).toContain("as restrictive for insert to authenticated");
    expect(sql).toContain("bucket_id not in ('capture-images','capture-image-candidates','capture-image-candidates-fresh-20260914')");
    expect(sql).toContain("drop policy if exists capture_candidates_insert on storage.objects");
    expect(sql).toContain("drop policy if exists capture_fresh_insert on storage.objects");
  });

  it("retains durable admitted/abandoned inventory and integrates erasure cleanup", () => {
    const sql = migration();
    for (const clause of [
      "state in ('reserved','uploaded','published','abandoned','released','deleted')",
      "capture_image_operation_inventory",
      "capture_image_inventory_remaining",
      "delete from public.capture_image_operations where owner_id=p_owner_id",
      "delete from public.capture_image_owner_usage where owner_id=p_owner_id",
      "or exists(select 1 from public.capture_image_operations where owner_id=p_owner_id)",
      "provider inventory and quiescence are not attested",
    ]) expect(sql).toContain(clause);
  });

  it("CAS-binds reconciliation to the owner, claimed state, operation version, and lease", () => {
    const sql = migration();
    for (const clause of [
      "perform public.capture_account_owner_lock(operation.owner_id)",
      "'claimedstate',v_claimed_state",
      "'operationversion',operation.operation_version",
      "operation.operation_version<>p_operation_version",
      "operation.state is distinct from p_claimed_state",
      "state=p_claimed_state and reconciliation_lease_id=p_reconciliation_lease_id",
    ]) expect(sql).toContain(clause);
    expect(sql).toContain("reconcile_capture_image_operation(uuid,uuid,bigint,text,boolean)");
  });

  it("attests exact direct-upload policy, publication trigger, ACL, and singleton defaults", () => {
    const sql = migration();
    for (const clause of [
      "capture_image_admission_contract_fingerprint",
      "pg_get_expr(policy.polwithcheck,policy.polrelid)",
      "policy.polroles=array[(select oid from pg_catalog.pg_roles where rolname='authenticated')]::oid[]",
      "policy.polqual is null",
      "trigger.tgenabled='o' and trigger.tgtype=7",
      "pg_get_functiondef(trigger.tgfoid)",
      "policy.admission_fingerprint=public.capture_image_admission_contract_fingerprint()",
      "(select count(*)=1 from public.capture_image_storage_policy)",
      "policy.max_objects=256 and policy.max_bytes=576000000",
      "not policy.stale_reclaim_enabled",
    ]) expect(sql).toContain(clause);
    const verify = verification();
    expect(verify).toContain("(select count(*) from public.capture_image_storage_policy)<>1");
    expect(verify).toContain("fresh image activation admission fingerprint mismatch");
  });

  it("ships a read-only hosted structural verifier without claiming provider inventory", () => {
    const sql = verification();
    expect(sql).toContain("begin read only");
    expect(sql).toContain("capture_image_admission_ready()");
    expect(sql).toContain("authenticated image mutation privilege remains");
    expect(sql).toContain("capture_image_app_only_insert");
    expect(sql).toContain("capture_image_publication_admission_guard");
    expect(sql).toContain("image owner usage does not match durable operations");
    expect(sql).toContain("hosted storage contract still requires attestation");
  });
});
