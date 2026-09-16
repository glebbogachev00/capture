import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = () => readFileSync("supabase/migrations/20260913120000_capture_images.sql", "utf8");
describe("Cloud image policy migration (static contract, not a live RLS proof)", () => {
  it("requires a private size/MIME-restricted bucket provisioned via Storage API", () => {
    const sql = migration();
    expect(sql).toContain("from storage.buckets");
    expect(sql).toContain("public = false");
    expect(sql).toContain("file_size_limit = 2250000");
    expect(sql).toContain("image/png");
    expect(sql).not.toMatch(/insert into storage\.buckets/i);
  });
  it("guards all access with owner path and live paid entitlement, even with other permissive policies", () => {
    const sql = migration();
    expect(sql).toMatch(/as restrictive for all to authenticated/i);
    expect(sql).toMatch(/as restrictive for all to anon\s+using \(bucket_id <> 'capture-images'\)/i);
    expect(sql).toContain("(select auth.uid())::text");
    expect(sql).toContain("'^[A-Za-z0-9_-]{1,64}$'");
    expect(sql).toContain("cardinality(storage.foldername(name)) = 1");
    expect(sql).toContain("s.is_entitled = true");
    expect(sql).toContain("s.access_expires_at > now()");
    expect(sql).not.toContain("security definer");
  });
  it("allows only immutable inserts and authenticated reads, never signed links or overwrites", () => {
    const sql = migration();
    expect(sql).toMatch(/as restrictive for update to anon, authenticated/i);
    expect(sql).toMatch(/as restrictive for delete to anon, authenticated/i);
    expect(sql).toMatch(/as restrictive for select to anon, authenticated/i);
    expect(sql).toContain("storage.allow_any_operation");
    expect(sql).toContain("'object.get_authenticated_info'");
    expect(sql).toContain("'object.get_authenticated'");
    expect(sql).toMatch(/as restrictive for insert to anon, authenticated/i);
    expect(sql).toContain("storage.allow_only_operation('object.upload')");
    expect(sql).toMatch(/for insert to authenticated/i);
    expect(sql).toMatch(/for select to authenticated/i);
    expect(sql).toContain("begin;");
    expect(sql).toContain("commit;");
  });
});
