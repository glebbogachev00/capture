import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20260921210000_cloud_backup_reads.sql",
), "utf8").toLowerCase();

describe("owner backup-read Storage policy", () => {
  it("separates exact-owner SELECT from entitlement-gated publication INSERT", () => {
    expect(sql).toContain("create policy capture_image_publication_owner_select");
    expect(sql).toMatch(/owner_select[\s\S]*for select[\s\S]*user_id = \(select auth\.uid\(\)\)/);
    expect(sql).toContain("create policy capture_image_publication_owner_insert");
    expect(sql).toMatch(/owner_insert[\s\S]*for insert[\s\S]*is_entitled[\s\S]*access_expires_at > now\(\)/);
  });

  it.each([
    ["capture-images", "capture_images"],
    ["capture-image-candidates", "capture_candidates"],
    ["capture-image-candidates-fresh-20260914", "capture_fresh"],
  ])("keeps %s owner-readable while retaining a restrictive write entitlement", (bucket, prefix) => {
    expect(sql).toContain(`bucket_id <> '${bucket}'`);
    expect(sql).toContain(`create policy ${prefix}_write_entitlement`);
    expect(sql).toMatch(new RegExp(
      `create policy ${prefix}_write_entitlement[\\s\\S]*?for insert`,
    ));
  });

  it("upgrades existing quota constraints and seeds the recovery-read policy", () => {
    expect(sql).toContain("drop constraint if exists capture_cloud_owner_quotas_scope_check");
    expect(sql).toContain("drop constraint if exists capture_cloud_quota_policies_scope_check");
    expect(sql).toContain("'backup_read', 2000, 3600");
    expect(sql).toContain("on conflict (scope) do nothing");
  });

  it("re-attests and restores the app-owned fresh activation guard atomically", () => {
    expect(sql).toContain("lock table public.capture_image_fresh_activation in access exclusive mode");
    expect(sql).toContain("set policy_fingerprint = public.capture_image_fresh_policy_fingerprint()");
    expect(sql).toContain("create trigger capture_image_fresh_fixed");
    expect(sql).toContain("if not public.capture_image_publication_ready()");
  });
});
