import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260911120000_capture_boards.sql"), "utf8").toLowerCase();

describe("capture_boards migration security contract", () => {
  it("contains the tenant schema, bounded JSON checks, grants, and separate RLS policies", () => {
    for (const clause of [
      "create table if not exists public.capture_boards",
      "user_id uuid primary key references auth.users(id) on delete cascade",
      "board jsonb not null",
      "tombstones jsonb not null default '[]'::jsonb",
      "rev bigint not null check (rev >= 1)",
      "jsonb_typeof(board) = 'object'",
      "jsonb_typeof(tombstones) = 'array'",
      "octet_length(board::text) + octet_length(tombstones::text) <= 2000000",
      "enable row level security",
      "revoke all on table public.capture_boards from anon, authenticated",
      "grant select, insert, update, delete on table public.capture_boards to authenticated",
      "create policy capture_boards_select",
      "create policy capture_boards_insert",
      "create policy capture_boards_update",
      "create policy capture_boards_delete",
      "using ((select auth.uid()) = user_id)",
      "with check ((select auth.uid()) = user_id)",
    ]) expect(sql).toContain(clause);
    expect(sql).not.toContain("service_role");
    expect(sql).not.toContain("for all");
  });

  it("is explicitly only a static contract, not live RLS proof", () => {
    expect(sql).toContain("-- static contract");
  });
});
