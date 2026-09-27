import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = "supabase/migrations/20260926230000_account_erasure_readonly_fence.sql";
const migration = () => readFileSync(path, "utf8").toLowerCase();

describe("account erasure read-only fence migration", () => {
  it("replaces row locking with the shared owner transaction lock", () => {
    const sql = migration();
    const definition = sql.slice(
      sql.indexOf("create or replace function public.capture_account_read_allowed"),
      sql.indexOf("$$;", sql.indexOf("create or replace function public.capture_account_read_allowed")) + 3,
    );

    expect(definition).toContain("language plpgsql volatile security definer");
    expect(definition).toContain("perform public.capture_account_owner_lock(p_user_id)");
    expect(definition).toContain("from public.capture_account_erasure_operations");
    expect(definition).toContain("return v_stage = 'prepared'");
    expect(definition).not.toContain("for share");
    expect(definition).not.toContain("for update");
  });

  it("preserves exact-owner checks and authenticated/service grants", () => {
    const sql = migration();

    expect(sql).toContain("v_caller is distinct from p_user_id");
    expect(sql).toContain("exact owner required");
    expect(sql).toContain(
      "revoke all on function public.capture_account_read_allowed(uuid) from public, anon",
    );
    expect(sql).toContain(
      "grant execute on function public.capture_account_read_allowed(uuid) to authenticated, service_role",
    );
  });
});
