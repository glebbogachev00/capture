import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");
const before = (text: string, first: string, second: string) => {
  const firstIndex = text.indexOf(first);
  const secondIndex = text.indexOf(second);
  expect(firstIndex, first).toBeGreaterThanOrEqual(0);
  expect(secondIndex, second).toBeGreaterThan(firstIndex);
};

describe("account-writable fence coverage", () => {
  it("authorizes board PUT before body admission and leaves PostgreSQL as the final race boundary", () => {
    const board = source("src/lib/cloudBoard.ts");
    before(board, "authorizeCloudRequest(request, \"board_write\"", "readBoundedBody(request)");

    const migration = source("supabase/migrations/20260922100000_account_erasure.sql");
    for (const policy of ["capture_boards_insert", "capture_boards_update", "capture_boards_delete"]) {
      expect(migration).toContain(`create policy ${policy}`);
    }
    expect(migration).toContain("capture_account_write_allowed((select auth.uid()))");
  });

  it("checks lifecycle before image bytes and fences reservation, upload recording, and publication finalization", () => {
    const image = source("src/lib/cloudImage.ts");
    before(image, 'client.rpc("capture_account_deleting"', "readImage(request)");
    before(image, 'service.rpc("reserve_capture_image_storage"', ".storage.from(reservation.bucket).upload(");

    const admission = source("supabase/migrations/20260922200000_image_storage_admissions.sql");
    for (const boundary of [
      "reserve_capture_image_storage",
      "record_capture_image_storage_upload",
      "finalize_capture_image_storage",
      "capture_image_publication_admission_guard_fn",
    ]) expect(admission).toContain(boundary);
    expect(admission.match(/capture_account_write_allowed\(p_owner_id\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("fences checkout and portal before Polar capability invocation", () => {
    const polar = source("src/lib/polar.ts");
    const checkout = polar.slice(polar.indexOf("export async function handleCheckout"), polar.indexOf("export async function handleCustomerPortal"));
    before(checkout, "deps.isAccountErasing(identity.userId)", "requestPlan(request)");
    before(checkout, "deps.acquireExternalWork", "deps.createCheckout");

    const portal = polar.slice(polar.indexOf("export async function handleCustomerPortal"), polar.indexOf("export function normalizeSubscription"));
    before(portal, "deps.isAccountErasing(identity.userId)", "deps.acquireExternalWork");
    before(portal, "deps.acquireExternalWork", "deps.createCustomerSession");
  });

  it("serializes late webhooks and reconciliation through the owner fence", () => {
    const migration = source("supabase/migrations/20260922100000_account_erasure.sql");
    const webhookBase = migration.slice(
      migration.indexOf("create or replace function public.apply_polar_subscription_event_base"),
      migration.indexOf("create or replace function public.apply_polar_subscription_event(",
        migration.indexOf("create or replace function public.apply_polar_subscription_event_base")),
    );
    const webhook = migration.slice(
      migration.indexOf("create or replace function public.apply_polar_subscription_event(",
        migration.indexOf("create or replace function public.apply_polar_subscription_event_base")),
      migration.indexOf("create or replace function public.queue_invalid_polar_event"),
    );
    before(webhook, "lock_polar_parent", "capture_account_owner_lock(observed_owner)");
    before(webhook, "capture_account_owner_lock(observed_owner)", "for update");
    before(webhook, "for update", "previous.user_id is distinct from observed_owner");
    before(webhook, "previous.user_id is distinct from observed_owner", "rewind_capture_account_erasure_to_polar(observed_owner)");
    before(webhook, "rewind_capture_account_erasure_to_polar(observed_owner)", "applied := public.apply_polar_subscription_event_base");
    expect(webhookBase).toContain("capture_account_write_allowed(p_user_id)");
    expect(webhookBase).not.toContain("rewind_capture_account_erasure_to_polar");

    for (const fn of ["queue_invalid_polar_event", "claim_polar_reconciliation", "finish_polar_reconciliation", "next_polar_reconciliation"]) {
      const start = migration.indexOf(`function public.${fn}`);
      expect(start, fn).toBeGreaterThanOrEqual(0);
      expect(migration.slice(start, start + 4_500), fn).toContain("capture_account_write_allowed");
    }
    for (const fn of ["queue_invalid_polar_event", "claim_polar_reconciliation", "finish_polar_reconciliation"]) {
      const start = migration.indexOf(`function public.${fn}`);
      const end = migration.indexOf("$$;", start);
      const body = migration.slice(start, end);
      before(body, "capture_account_owner_lock(observed_owner)", "for update");
      expect(body, fn).toContain("s.user_id is distinct from observed_owner");
    }

    const server = source("src/lib/polarServer.ts");
    before(server, 'admin.rpc("acquire_capture_external_work"', "polar.subscriptions.get");
    before(server, "polar.subscriptions.get", 'admin.rpc("finish_polar_reconciliation"');
  });

  it("checks lifecycle and acquires a durable admission before any managed provider work", () => {
    const guard = source("src/lib/cloudRequestGuard.ts");
    before(guard, "deps.isAccountErasing(identity)", "deps.consumeQuota");
    before(guard, "deps.consumeQuota", "deps.acquireExternalWork");

    const managed = source("src/lib/managedAiAuthorization.test.ts");
    expect(managed).toContain("keeps the discovered provider-route inventory pinned");
    expect(managed).toContain("calls the shared guard before body, limiter, or provider work");
  });
});
