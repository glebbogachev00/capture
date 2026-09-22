import { describe, expect, it, vi } from "vitest";
import { errors as polarErrors } from "@polar-sh/sdk/2026-04";
import { AuthApiError } from "@supabase/supabase-js";
import {
  SupabaseAccountErasureRepository,
  createAppDataErasureAdapter,
  createAuthErasureAdapter,
  createDeadlineFetch,
  createPolarErasureAdapter,
  createSessionFenceAdapter,
  createStorageErasureAdapter,
  destructiveIdentityFromSupabase,
  polarCustomerNotFound,
  supabaseAuthUserNotFound,
} from "./accountErasure.server";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const operation = {
  operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  ownerId: owner,
  stage: "polar",
  version: 3,
  attemptCount: 1,
  retryCount: 0,
  retryAfter: null,
  lastErrorCode: null,
  leaseId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  leaseExpiresAt: "2026-09-22T10:00:30.000Z",
  confirmedAt: "2026-09-22T10:00:00.000Z",
  completedAt: null,
  receiptExpiresAt: "2026-09-22T11:00:00.000Z",
};

describe("destructive Supabase identity evidence", () => {
  it("requires live getUser and same-owner email claims with a timestamped OTP method", async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: {
      id: owner,
      email: "owner@example.test",
      email_confirmed_at: "2026-09-22T09:00:00.000Z",
    } }, error: null });
    const getClaims = vi.fn().mockResolvedValue({ data: { claims: {
      sub: owner,
      email: "owner@example.test",
      session_id: "session-a",
      amr: [
        { method: "token_refresh", timestamp: 1_795_000_010 },
        { method: "otp", timestamp: 1_795_000_000 },
      ],
    } }, error: null });
    await expect(destructiveIdentityFromSupabase({ auth: { getUser, getClaims } }))
      .resolves.toEqual({ userId: owner, sessionId: "session-a", otpAuthenticatedAt: new Date(1_795_000_000_000) });
    expect(getUser).toHaveBeenCalledOnce();
    expect(getClaims).toHaveBeenCalledOnce();
  });

  it.each([
    [{ sub: owner, email: "owner@example.test", session_id: "session-a", amr: [] }],
    [{ sub: owner, email: "owner@example.test", session_id: "session-a", amr: [{ method: "password", timestamp: 1_795_000_000 }] }],
    [{ sub: owner, email: "owner@example.test", session_id: "", amr: [{ method: "otp", timestamp: 1_795_000_000 }] }],
    [{ sub: "not-a-uuid", email: "owner@example.test", session_id: "session-a", amr: [{ method: "otp", timestamp: 1_795_000_000 }] }],
    [{ sub: owner, email: "other@example.test", session_id: "session-a", amr: [{ method: "otp", timestamp: 1_795_000_000 }] }],
  ])("fails closed for malformed, cross-email, or non-OTP claims %j", async (claims) => {
    await expect(destructiveIdentityFromSupabase({ auth: {
      getUser: async () => ({ data: { user: { id: owner, email: "owner@example.test", email_confirmed_at: "2026-09-22T09:00:00.000Z" } }, error: null }),
      getClaims: async () => ({ data: { claims }, error: null }),
    } })).resolves.toBeNull();
  });

  it("fails closed when live Auth cannot read a confirmed user or returns a different owner", async () => {
    const claims = { sub: owner, email: "owner@example.test", session_id: "session-a", amr: [{ method: "otp", timestamp: 1_795_000_000 }] };
    for (const live of [
      { data: { user: null }, error: { code: "unavailable" } },
      { data: { user: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "owner@example.test", email_confirmed_at: "2026-09-22T09:00:00.000Z" } }, error: null },
      { data: { user: { id: owner, email: "owner@example.test", email_confirmed_at: null } }, error: null },
    ]) {
      await expect(destructiveIdentityFromSupabase({ auth: {
        getUser: async () => live,
        getClaims: async () => ({ data: { claims }, error: null }),
      } })).resolves.toBeNull();
    }
  });
});

describe("Supabase erasure operation repository", () => {
  it("maps only complete provider rows and passes all compare-and-swap fields", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: operation, error: null });
    const repository = new SupabaseAccountErasureRepository({ rpc });
    await expect(repository.claim({
      leaseId: operation.leaseId,
      now: new Date("2026-09-22T10:00:00.000Z"),
      leaseExpiresAt: new Date(operation.leaseExpiresAt),
    })).resolves.toEqual(operation);
    expect(rpc).toHaveBeenCalledWith("claim_capture_account_erasure", {
      p_lease_id: operation.leaseId,
      p_now: "2026-09-22T10:00:00.000Z",
      p_lease_expires_at: operation.leaseExpiresAt,
    });

    rpc.mockResolvedValueOnce({ data: { ...operation, ownerId: null }, error: null });
    await expect(repository.claim({ leaseId: operation.leaseId, now: new Date(), leaseExpiresAt: new Date(Date.now() + 1_000) }))
      .rejects.toThrow("Account erasure operation failed");

    rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(repository.advance({
      operationId: operation.operationId, ownerId: owner, leaseId: operation.leaseId,
      version: 3, stage: "polar", nextStage: "sessions", now: new Date("2026-09-22T10:00:00.000Z"),
    })).resolves.toBe(true);
    expect(rpc).toHaveBeenLastCalledWith("advance_capture_account_erasure", expect.objectContaining({
      p_operation_id: operation.operationId, p_owner_id: owner, p_lease_id: operation.leaseId,
      p_version: 3, p_stage: "polar", p_next_stage: "sessions",
    }));
  });

  it("fails closed on provider errors and malformed booleans", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "true", error: null });
    const repository = new SupabaseAccountErasureRepository({ rpc });
    await expect(repository.fail({
      operationId: operation.operationId, ownerId: owner, leaseId: operation.leaseId,
      version: 3, stage: "polar", errorCode: "polar_unavailable", retryAfter: new Date(),
    })).rejects.toThrow("Account erasure operation failed");
    rpc.mockResolvedValueOnce({ data: null, error: { code: "private" } });
    await expect(repository.status({ operationId: operation.operationId, receiptHash: "a".repeat(64), now: new Date() }))
      .rejects.toThrow("Account erasure operation failed");
  });
});

describe("injected provider erasure adapters", () => {
  it("aborts Supabase provider calls at the worker deadline", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const bounded = createDeadlineFetch(fetchImpl as typeof fetch, 250);
    const pending = bounded("https://supabase.test/storage/v1/object/list", { method: "POST" });
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(250);
    await rejection;
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it("recognizes only Polar's documented typed ResourceNotFound error", () => {
    const absent = new polarErrors.ResourceNotFound(404, {
      error: "ResourceNotFound",
      detail: "Customer not found.",
    });
    expect(polarCustomerNotFound(absent)).toBe(true);
    for (const gateway404 of [
      { status: 404 }, { statusCode: 404 }, { response: { status: 404 } },
    ]) expect(polarCustomerNotFound(gateway404)).toBe(false);
  });

  it("recognizes only Supabase Auth's typed user_not_found API error", () => {
    expect(supabaseAuthUserNotFound(new AuthApiError("User not found", 404, "user_not_found"))).toBe(true);
    expect(supabaseAuthUserNotFound(new AuthApiError("Route not found", 404, "unexpected_failure"))).toBe(false);
    expect(supabaseAuthUserNotFound({ status: 404, code: "user_not_found" })).toBe(false);
  });

  it("deletes and anonymizes the Polar customer by immutable external owner id, then reads absence", async () => {
    const deleteExternal = vi.fn().mockResolvedValue(undefined);
    const getExternal = vi.fn().mockRejectedValue(new polarErrors.ResourceNotFound(404, {
      error: "ResourceNotFound", detail: "Customer not found.",
    }));
    const adapter = createPolarErasureAdapter({ customers: { deleteExternal, getExternal } });
    await expect(adapter.deleteOrAnonymizeByExternalId(owner)).resolves.toBe("deleted");
    expect(deleteExternal).toHaveBeenCalledWith(owner, { anonymize: true }, { timeout: 30 });
    await expect(adapter.readbackByExternalId(owner)).resolves.toBe("absent");
    expect(getExternal).toHaveBeenCalledWith(owner, { timeout: 30 });
    getExternal.mockRejectedValueOnce({ statusCode: 404 });
    await expect(adapter.readbackByExternalId(owner)).rejects.toThrow("Account erasure operation failed");
    deleteExternal.mockRejectedValueOnce(new polarErrors.ResourceNotFound(404, {
      error: "ResourceNotFound", detail: "Customer not found.",
    }));
    await expect(adapter.deleteOrAnonymizeByExternalId(owner)).resolves.toBe("already-absent");
    deleteExternal.mockRejectedValueOnce({ statusCode: 404 });
    await expect(adapter.deleteOrAnonymizeByExternalId(owner)).rejects.toThrow("Account erasure operation failed");
  });

  it("allows a delayed Polar deletion and readback to succeed inside the thirty-second provider bound", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-22T10:00:00.000Z");
    try {
      const deleteExternal = vi.fn((_ownerId: string, _query: { anonymize: boolean }, options: { timeout: number }) =>
        new Promise<void>((resolve, reject) => setTimeout(
          () => options.timeout === 30 ? resolve() : reject(new Error("wrong timeout")),
          29_000,
        )));
      const getExternal = vi.fn((_ownerId: string, options: { timeout: number }) =>
        new Promise<never>((_resolve, reject) => setTimeout(
          () => reject(options.timeout === 30
            ? new polarErrors.ResourceNotFound(404, { error: "ResourceNotFound", detail: "Customer not found." })
            : new Error("wrong timeout")),
          29_000,
        )));
      const adapter = createPolarErasureAdapter({ customers: { deleteExternal, getExternal } });
      const deletion = adapter.deleteOrAnonymizeByExternalId(owner);
      const deletionResult = expect(deletion).resolves.toBe("deleted");
      await vi.advanceTimersByTimeAsync(29_000);
      await deletionResult;
      const readback = adapter.readbackByExternalId(owner);
      const readbackResult = expect(readback).resolves.toBe("absent");
      await vi.advanceTimersByTimeAsync(29_000);
      await readbackResult;
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists/removes exact owner paths and requires attested exact bucket inventory for provider authority", async () => {
    const list = vi.fn().mockResolvedValue({ data: [{ name: "one" }, { name: "two" }], error: null });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const info = vi.fn().mockResolvedValue({ data: null, error: { code: "NoSuchKey" } });
    const rpc = vi.fn().mockImplementation(async (name: string) => {
      if (name === "capture_image_operation_inventory") return { data: [{
        operation_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        bucket_id: "capture-image-candidates",
        object_path: `${owner}/candidate`,
      }], error: null };
      if (name === "mark_capture_image_operation_deleted") return { data: true, error: null };
      if (name === "capture_image_inventory_remaining") return { data: false, error: null };
      return { data: null, error: { code: "unexpected" } };
    });
    const from = vi.fn().mockReturnValue({ list, remove, info });
    const listBuckets = vi.fn().mockResolvedValue({ data: [
      { id: "capture-images" },
      { id: "capture-image-candidates" },
      { id: "capture-image-candidates-fresh-20260914" },
      { id: "unrelated-product-files" },
    ], error: null });
    const client = { rpc, storage: { from, listBuckets } };
    await expect(createStorageErasureAdapter(client).providerInventoryIsAuthoritative()).resolves.toBe(false);
    const adapter = createStorageErasureAdapter(client, { inventoryAttested: true });
    await expect(adapter.providerInventoryIsAuthoritative()).resolves.toBe(true);
    listBuckets.mockResolvedValueOnce({ data: [
      { id: "capture-images" },
      { id: "capture-image-candidates" },
      { id: "capture-image-candidates-fresh-20260914" },
      { id: "capture-unexpected" },
    ], error: null });
    await expect(adapter.providerInventoryIsAuthoritative()).resolves.toBe(false);
    await expect(adapter.listAdmittedCandidates(owner, 100)).resolves.toEqual([{
      operationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      bucket: "capture-image-candidates",
      path: `${owner}/candidate`,
    }]);
    await expect(adapter.ownerObjectExists("capture-image-candidates", owner, `${owner}/candidate`)).resolves.toBe(false);
    await expect(adapter.markAdmittedCandidateDeleted(owner, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")).resolves.toBeUndefined();
    await expect(adapter.hasAdmittedCandidates(owner)).resolves.toBe(false);
    await expect(adapter.listOwnerObjects("capture-images", owner, 100))
      .resolves.toEqual([`${owner}/one`, `${owner}/two`]);
    expect(list).toHaveBeenCalledWith(owner, { limit: 100, offset: 0, sortBy: { column: "name", order: "asc" } });
    await expect(adapter.removeOwnerObjects("capture-images", owner, [`${owner}/one`]))
      .resolves.toEqual({ failed: [] });
    expect(remove).toHaveBeenCalledWith([`${owner}/one`]);
    remove.mockResolvedValueOnce({ data: null, error: { code: "NoSuchKey", statusCode: 404 } });
    await expect(adapter.removeOwnerObjects("capture-images", owner, [`${owner}/already-missing`]))
      .resolves.toEqual({ failed: [] });
  });

  it("uses service RPC readback for app rows and Auth hard-delete/readback last", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    const app = createAppDataErasureAdapter({ rpc });
    await app.deleteOwnerRows(owner);
    await expect(app.hasOwnerRows(owner)).resolves.toBe(false);
    expect(rpc.mock.calls).toEqual([
      ["delete_capture_account_app_rows", { p_owner_id: owner }],
      ["capture_account_app_rows_exist", { p_owner_id: owner }],
    ]);

    const deleteUser = vi.fn().mockResolvedValue({ data: {}, error: null });
    const getUserById = vi.fn().mockResolvedValue({
      data: { user: null },
      error: new AuthApiError("User not found", 404, "user_not_found"),
    });
    const auth = createAuthErasureAdapter({ auth: { admin: { deleteUser, getUserById } } });
    await expect(auth.hardDeleteUser(owner)).resolves.toBe("deleted");
    expect(deleteUser).toHaveBeenCalledWith(owner, false);
    await expect(auth.userExists(owner)).resolves.toBe(false);
    for (const malformedReadback of [
      { data: { user: null }, error: null },
      { data: null, error: null },
      { data: { user: {} }, error: null },
      { data: { user: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } }, error: null },
      { data: { user: { id: "not-a-uuid" } }, error: null },
    ]) {
      getUserById.mockResolvedValueOnce(malformedReadback);
      await expect(auth.userExists(owner)).rejects.toThrow("Account erasure operation failed");
    }
    getUserById.mockResolvedValueOnce({ data: { user: { id: owner } }, error: null });
    await expect(auth.userExists(owner)).resolves.toBe(true);
    getUserById.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthApiError("Gateway route not found", 404, "unexpected_failure"),
    });
    await expect(auth.userExists(owner)).rejects.toThrow("Account erasure operation failed");

    deleteUser.mockResolvedValueOnce({
      data: null,
      error: new AuthApiError("User not found", 404, "user_not_found"),
    });
    await expect(auth.hardDeleteUser(owner)).resolves.toBe("already-absent");
    deleteUser.mockResolvedValueOnce({
      data: null,
      error: new AuthApiError("Gateway route not found", 404, "unexpected_failure"),
    });
    await expect(auth.hardDeleteUser(owner)).rejects.toThrow("Account erasure operation failed");
  });

  it("uses the durable database fence as session authority until Auth hard-delete revokes refresh families", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const sessions = createSessionFenceAdapter({ rpc });
    await expect(sessions.revokeAllForOwner(owner)).resolves.toBeUndefined();
    await expect(sessions.hasActiveSessions(owner)).resolves.toBe(false);
    expect(rpc.mock.calls).toEqual([
      ["establish_capture_account_session_fence", { p_owner_id: owner }],
      ["capture_account_session_fence_authoritative", { p_owner_id: owner }],
    ]);
  });
});
