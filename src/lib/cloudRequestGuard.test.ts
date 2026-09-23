import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeCloudRequest,
  cloudQuotaPolicy,
  consumeQuotaWithRpc,
  type CloudRequestGuardDependencies,
} from "@/lib/cloudRequestGuard";
import {
  MANAGED_AI_RELEASE_DEADLINE_MS,
  MANAGED_AI_DEFERRED_ADMISSION_DEADLINE_MS,
  scheduleManagedAiDeferredWork,
  withManagedAiAdmission,
} from "@/lib/cloudRequestGuard.server";

const request = (owner = "owner-a") => new Request("https://capture.test/api/sort", {
  method: "POST",
  headers: { "X-Capture-Owner": owner },
  body: "private capture text",
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function dependencies(overrides: Partial<CloudRequestGuardDependencies> = {}): CloudRequestGuardDependencies {
  return {
    isCloudHost: () => true,
    isConfigured: () => true,
    requiresEntitlement: () => true,
    verifyIdentity: vi.fn().mockResolvedValue({ userId: "owner-a" }),
    hasEntitlement: vi.fn().mockResolvedValue(true),
    isAccountErasing: vi.fn().mockResolvedValue(false),
    consumeQuota: vi.fn().mockResolvedValue({ allowed: true, retryAfterSec: 0 }),
    acquireExternalWork: vi.fn().mockResolvedValue({ admissionId: "admission-a" }),
    releaseExternalWork: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("shared Cloud request guard", () => {
  it("leaves anonymous managed AI available only outside the Cloud host", async () => {
    const deps = dependencies({ isCloudHost: () => false });
    await expect(authorizeCloudRequest(request(), "managed_ai", deps)).resolves.toEqual({ mode: "non-cloud" });
    expect(deps.verifyIdentity).not.toHaveBeenCalled();
    expect(deps.hasEntitlement).not.toHaveBeenCalled();
    expect(deps.consumeQuota).not.toHaveBeenCalled();
  });

  it("denies an unverified identity before access or quota reads", async () => {
    const deps = dependencies({ verifyIdentity: vi.fn().mockResolvedValue(null) });
    const result = await authorizeCloudRequest(request(), "managed_ai", deps);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect(await (result as Response).json()).toEqual({ error: "unauthorized" });
    expect(deps.hasEntitlement).not.toHaveBeenCalled();
    expect(deps.consumeQuota).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, 428],
    ["owner-b", 412],
  ])("requires the exact owner precondition %s", async (owner, status) => {
    const deps = dependencies();
    const headers = owner ? { "X-Capture-Owner": owner } : undefined;
    const result = await authorizeCloudRequest(new Request("https://capture.test/api/sort", { method: "POST", headers }), "managed_ai", deps);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(status);
    expect(deps.hasEntitlement).not.toHaveBeenCalled();
    expect(deps.consumeQuota).not.toHaveBeenCalled();
  });

  it("denies an erasing account before entitlement and quota when lifecycle support exists", async () => {
    const deps = dependencies({ isAccountErasing: vi.fn().mockResolvedValue(true) });
    const result = await authorizeCloudRequest(request(), "managed_ai", deps);
    expect((result as Response).status).toBe(403);
    expect(await (result as Response).json()).toEqual({ error: "account unavailable" });
    expect(deps.hasEntitlement).not.toHaveBeenCalled();
    expect(deps.consumeQuota).not.toHaveBeenCalled();
  });

  it("fails closed before billing when the lifecycle fence adapter is missing", async () => {
    const deps = dependencies();
    delete (deps as Partial<CloudRequestGuardDependencies>).isAccountErasing;
    const result = await authorizeCloudRequest(request(), "managed_ai", deps);
    expect((result as Response).status).toBe(503);
    expect(deps.hasEntitlement).not.toHaveBeenCalled();
    expect(deps.consumeQuota).not.toHaveBeenCalled();
  });

  it("requires current eligible Cloud access before consuming quota", async () => {
    const deps = dependencies({ hasEntitlement: vi.fn().mockResolvedValue(false) });
    const result = await authorizeCloudRequest(request(), "managed_ai", deps);
    expect((result as Response).status).toBe(402);
    expect(await (result as Response).json()).toEqual({ error: "capture cloud access required" });
    expect(deps.consumeQuota).not.toHaveBeenCalled();
  });

  it("supports an explicitly subscription-optional Cloud cohort while retaining identity and quota", async () => {
    const deps = dependencies({ requiresEntitlement: () => false });
    await expect(authorizeCloudRequest(request(), "managed_ai", deps)).resolves.toMatchObject({
      mode: "cloud", ownerId: "owner-a", admissionId: "admission-a",
    });
    expect(deps.hasEntitlement).not.toHaveBeenCalled();
    expect(deps.consumeQuota).toHaveBeenCalledWith("owner-a", cloudQuotaPolicy("managed_ai"));
    expect(deps.acquireExternalWork).toHaveBeenCalledWith("owner-a", "managed_ai");
  });

  it("binds a deferred managed-AI admission and release to the verified owner", async () => {
    const acquireExternalWork = vi.fn()
      .mockResolvedValueOnce({ admissionId: "primary-admission" })
      .mockResolvedValueOnce({ admissionId: "deferred-admission" });
    const releaseExternalWork = vi.fn().mockResolvedValue(undefined);
    const result = await authorizeCloudRequest(request(), "managed_ai", dependencies({
      acquireExternalWork,
      releaseExternalWork,
    }));
    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response || result.mode !== "cloud") throw new Error("expected cloud authorization");

    const deferred = await result.acquireDeferredManagedAiAdmission?.();
    expect(deferred).toBeTruthy();
    await deferred?.release();

    expect(acquireExternalWork.mock.calls).toEqual([
      ["owner-a", "managed_ai"],
      ["owner-a", "managed_ai"],
    ]);
    expect(releaseExternalWork).toHaveBeenCalledExactlyOnceWith(
      "owner-a",
      "deferred-admission",
    );
  });

  it("allows exact-owner backup reads after billing expires while retaining durable quota", async () => {
    const deps = dependencies({ hasEntitlement: vi.fn().mockResolvedValue(false) });
    await expect(authorizeCloudRequest(request(), "backup_read", deps))
      .resolves.toEqual({ mode: "cloud", ownerId: "owner-a" });
    expect(deps.hasEntitlement).not.toHaveBeenCalled();
    expect(deps.consumeQuota).toHaveBeenCalledWith("owner-a", cloudQuotaPolicy("backup_read"));
  });

  it("fails closed when durable external-work admission cannot be acquired", async () => {
    const deps = dependencies({ acquireExternalWork: vi.fn().mockResolvedValue(null) });
    const result = await authorizeCloudRequest(request(), "managed_ai", deps);
    expect((result as Response).status).toBe(503);
    expect(deps.releaseExternalWork).not.toHaveBeenCalled();
  });

  it("returns a bounded denial and retry boundary when the durable owner quota is exhausted", async () => {
    const deps = dependencies({ consumeQuota: vi.fn().mockResolvedValue({ allowed: false, retryAfterSec: 37 }) });
    const result = await authorizeCloudRequest(request(), "managed_ai", deps);
    expect((result as Response).status).toBe(429);
    expect((result as Response).headers.get("Retry-After")).toBe("37");
    expect((result as Response).headers.get("Cache-Control")).toBe("private, no-store");
    expect(await (result as Response).json()).toEqual({ error: "quota exceeded" });
  });

  it.each([
    ["identity", { verifyIdentity: vi.fn().mockRejectedValue(new Error("private identity detail")) }],
    ["lifecycle", { isAccountErasing: vi.fn().mockRejectedValue(new Error("private lifecycle detail")) }],
    ["entitlement", { hasEntitlement: vi.fn().mockRejectedValue(new Error("private billing detail")) }],
    ["quota", { consumeQuota: vi.fn().mockRejectedValue(new Error("private database detail")) }],
  ])("fails closed with content-free output when %s is unavailable", async (_stage, override) => {
    const result = await authorizeCloudRequest(request(), "managed_ai", dependencies(override));
    expect((result as Response).status).toBe(503);
    expect(await (result as Response).json()).toEqual({ error: "cloud authorization unavailable" });
  });
  it.each([
    ["identity", "verifyIdentity"],
    ["lifecycle", "isAccountErasing"],
    ["access", "hasEntitlement"],
    ["quota", "consumeQuota"],
    ["admission", "acquireExternalWork"],
  ] as const)("cancels and bounds a stalled %s dependency", async (_stage, method) => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const stalled = vi.fn((...args: unknown[]) => {
      received = args.at(-1) as AbortSignal;
      return new Promise<never>(() => {});
    });
    const deps = dependencies({ [method]: stalled } as Partial<CloudRequestGuardDependencies>);
    const pending = authorizeCloudRequest(request(), "managed_ai", deps, { signal: controller.signal });
    await vi.waitFor(() => expect(stalled).toHaveBeenCalledOnce());
    controller.abort(new DOMException("route deadline", "TimeoutError"));

    const response = await pending;
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(503);
    expect(received).toBe(controller.signal);
  });

  it("releases a late-created admission boundedly after route cancellation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let resolveAdmission!: (value: { admissionId: string }) => void;
    let releaseSignal: AbortSignal | undefined;
    const acquireExternalWork = vi.fn(() => new Promise<{ admissionId: string }>((resolve) => {
      resolveAdmission = resolve;
    }));
    const releaseExternalWork = vi.fn((_owner: string, _admission: string, signal?: AbortSignal) => {
      releaseSignal = signal;
      return new Promise<void>(() => {});
    });
    const pending = authorizeCloudRequest(request(), "managed_ai", dependencies({
      acquireExternalWork,
      releaseExternalWork,
    }), { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new DOMException("route deadline", "TimeoutError"));
    expect((await pending as Response).status).toBe(503);

    resolveAdmission({ admissionId: "late-admission" });
    await vi.advanceTimersByTimeAsync(0);
    expect(releaseExternalWork).toHaveBeenCalledWith(
      "owner-a", "late-admission", expect.any(AbortSignal),
    );
    await vi.advanceTimersByTimeAsync(MANAGED_AI_RELEASE_DEADLINE_MS);
    expect(releaseSignal?.aborted).toBe(true);
  });
});

describe("Cloud owner quota policy", () => {
  it("passes only the database-owned scope, never client-controlled policy values", () => {
    expect(cloudQuotaPolicy("managed_ai")).toEqual({ scope: "managed_ai" });
    expect(cloudQuotaPolicy("board_read")).toEqual({ scope: "board_read" });
    expect(cloudQuotaPolicy("board_write")).toEqual({ scope: "board_write" });
    expect(cloudQuotaPolicy("backup_read")).toEqual({ scope: "backup_read" });
  });

  it("uses the authenticated RPC adapter and rejects malformed provider output", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { allowed: false, retryAfterSec: 9 }, error: null });
    await expect(consumeQuotaWithRpc({ rpc }, "owner-a", { scope: "managed_ai" }))
      .resolves.toEqual({ allowed: false, retryAfterSec: 9 });
    expect(rpc).toHaveBeenCalledWith("consume_capture_cloud_quota", {
      p_scope: "managed_ai",
    });
    rpc.mockResolvedValueOnce({ data: { allowed: true, retryAfterSec: -1 }, error: null });
    await expect(consumeQuotaWithRpc({ rpc }, "owner-a", { scope: "managed_ai" }))
      .rejects.toThrow("Cloud quota operation failed");
  });
});

describe("managed external-work release", () => {
  it.each([
    { work: "success", release: "success" },
    { work: "success", release: "failure" },
    { work: "failure", release: "success" },
    { work: "failure", release: "failure" },
  ] as const)("preserves bounded $work work when release is a $release", async ({ work, release }) => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const providerError = new Error("private provider detail");
    const releaseExternalWork = release === "success"
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(new Error("private release detail"));
    const result = withManagedAiAdmission({
      mode: "cloud",
      ownerId: "owner-a",
      admissionId: "admission-a",
      releaseExternalWork,
    }, async () => {
      if (work === "failure") throw providerError;
      return Response.json({ error: "bounded route response" }, { status: 502 });
    });

    if (work === "failure") await expect(result).rejects.toBe(providerError);
    else {
      const response = await result;
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "bounded route response" });
    }
    expect(releaseExternalWork).toHaveBeenCalledOnce();
    if (release === "failure") {
      expect(info).toHaveBeenCalledExactlyOnceWith("[capture-ops]", {
        version: 1,
        event: "managed_ai_route",
        outcome: "failure",
        reason: "dependency_unavailable",
        latency: "not_measured",
        count: "not_measured",
      });
    } else {
      expect(info).not.toHaveBeenCalled();
    }
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/private release detail|private provider detail/);
  });

  it("releases the owner-bound admission in finally when provider work throws", async () => {
    const releaseExternalWork = vi.fn().mockResolvedValue(undefined);
    await expect(withManagedAiAdmission({
      mode: "cloud",
      ownerId: "owner-a",
      admissionId: "admission-a",
      releaseExternalWork,
    }, async () => { throw new Error("provider unavailable"); })).rejects.toThrow("provider unavailable");
    expect(releaseExternalWork).toHaveBeenCalledOnce();
  });

  it("bounds a never-settling release and preserves the completed route response", async () => {
    vi.useFakeTimers();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    let releaseSignal: AbortSignal | undefined;
    const releaseExternalWork = vi.fn((signal?: AbortSignal) => {
      releaseSignal = signal;
      return new Promise<void>(() => {});
    });
    const settled = vi.fn();
    const pending = withManagedAiAdmission({
      mode: "cloud",
      ownerId: "owner-a",
      admissionId: "admission-a",
      releaseExternalWork,
    }, async () => Response.json({ ok: true }, { status: 201 })).then((response) => {
      settled();
      return response;
    });

    await vi.advanceTimersByTimeAsync(MANAGED_AI_RELEASE_DEADLINE_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    const response = await pending;
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(releaseExternalWork).toHaveBeenCalledOnce();
    expect(releaseSignal?.aborted).toBe(true);
    expect(info).toHaveBeenCalledExactlyOnceWith("[capture-ops]", {
      version: 1,
      event: "managed_ai_route",
      outcome: "failure",
      reason: "dependency_unavailable",
      latency: "not_measured",
      count: "not_measured",
    });
  });

  it("consumes a late release rejection without replacing the provider error", async () => {
    vi.useFakeTimers();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const providerError = new Error("bounded provider failure");
    let rejectRelease!: (error: Error) => void;
    let releaseSignal: AbortSignal | undefined;
    const releaseExternalWork = vi.fn((signal?: AbortSignal) => {
      releaseSignal = signal;
      return new Promise<void>((_resolve, reject) => { rejectRelease = reject; });
    });
    const pending = withManagedAiAdmission({
      mode: "cloud",
      ownerId: "owner-a",
      admissionId: "admission-a",
      releaseExternalWork,
    }, async () => { throw providerError; });
    const rejection = expect(pending).rejects.toBe(providerError);

    await vi.advanceTimersByTimeAsync(MANAGED_AI_RELEASE_DEADLINE_MS);
    await rejection;
    expect(releaseSignal?.aborted).toBe(true);

    rejectRelease(new Error("private late release detail"));
    await Promise.resolve();
    await Promise.resolve();
    expect(info).toHaveBeenCalledExactlyOnceWith("[capture-ops]", {
      version: 1,
      event: "managed_ai_route",
      outcome: "failure",
      reason: "dependency_unavailable",
      latency: "not_measured",
      count: "not_measured",
    });
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/private late release detail|bounded provider failure/);
  });

  it("uses only the remaining route budget for a stalled admission release", async () => {
    vi.useFakeTimers();
    let releaseSignal: AbortSignal | undefined;
    const pending = withManagedAiAdmission({
      mode: "cloud",
      ownerId: "owner-a",
      admissionId: "admission-a",
      releaseExternalWork: vi.fn((signal?: AbortSignal) => {
        releaseSignal = signal;
        return new Promise<void>(() => {});
      }),
    }, async () => Response.json({ ok: true }), { deadlineAt: Date.now() + 125 });
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(124);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(200);
    expect(releaseSignal?.aborted).toBe(true);
  });

  it("schedules first and acquires the shadow admission only inside deferred work", async () => {
    const events: string[] = [];
    let task: (() => void | Promise<void>) | undefined;
    const releaseDeferred = vi.fn(async () => { events.push("release deferred"); });
    const authorization = {
      mode: "cloud" as const,
      ownerId: "owner-a",
      admissionId: "primary-admission",
      releaseExternalWork: vi.fn(async () => { events.push("release primary"); }),
      acquireDeferredManagedAiAdmission: vi.fn(async () => {
        events.push("acquire deferred");
        return { release: releaseDeferred };
      }),
    };

    await withManagedAiAdmission(authorization, async () => {
      expect(await scheduleManagedAiDeferredWork({
        authorization,
        enabled: true,
        schedule: (callback) => { events.push("schedule"); task = callback; },
        work: async () => { events.push("run deferred"); },
        onError: vi.fn(),
      })).toBe(true);
      events.push("primary complete");
    });

    expect(events).toEqual([
      "schedule",
      "primary complete",
      "release primary",
    ]);
    expect(releaseDeferred).not.toHaveBeenCalled();

    await task?.();
    expect(events).toEqual([
      "schedule",
      "primary complete",
      "release primary",
      "acquire deferred",
      "run deferred",
      "release deferred",
    ]);
    expect(releaseDeferred).toHaveBeenCalledOnce();
  });

  it("does not acquire a deferred admission when scheduling fails", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const authorization = {
      mode: "cloud" as const,
      ownerId: "owner-a",
      admissionId: "primary-admission",
      releaseExternalWork: vi.fn().mockResolvedValue(undefined),
      acquireDeferredManagedAiAdmission: vi.fn().mockResolvedValue({ release }),
    };

    await expect(scheduleManagedAiDeferredWork({
      authorization,
      enabled: true,
      schedule: () => { throw new Error("private scheduler detail"); },
      work: vi.fn(),
      onError,
    })).resolves.toBe(false);

    expect(release).not.toHaveBeenCalled();
    expect(authorization.acquireDeferredManagedAiAdmission).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("does not start unowned work when a scheduler invokes then throws", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const work = vi.fn();
    const onError = vi.fn();

    await expect(scheduleManagedAiDeferredWork({
      authorization: {
        mode: "cloud",
        ownerId: "owner-a",
        acquireDeferredManagedAiAdmission: vi.fn().mockResolvedValue({ release }),
      },
      enabled: true,
      schedule: (callback) => {
        void callback();
        throw new Error("private scheduler detail");
      },
      work,
      onError,
    })).resolves.toBe(false);

    await Promise.resolve();
    expect(work).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("does not acquire, schedule, or run deferred work while disabled", async () => {
    const acquire = vi.fn();
    const schedule = vi.fn();
    const work = vi.fn();

    await expect(scheduleManagedAiDeferredWork({
      authorization: {
        mode: "cloud",
        ownerId: "owner-a",
        admissionId: "primary-admission",
        releaseExternalWork: vi.fn(),
        acquireDeferredManagedAiAdmission: acquire,
      },
      enabled: false,
      schedule,
      work,
      onError: vi.fn(),
    })).resolves.toBe(false);

    expect(acquire).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it("bounds a never-settling deferred admission without delaying scheduling or running shadow work", async () => {
    vi.useFakeTimers();
    let task: (() => void | Promise<void>) | undefined;
    let admissionSignal: AbortSignal | undefined;
    const acquire = vi.fn((signal?: AbortSignal) => {
      admissionSignal = signal;
      return new Promise<never>(() => {});
    });
    const work = vi.fn();
    const onError = vi.fn();
    expect(await scheduleManagedAiDeferredWork({
      authorization: {
        mode: "cloud",
        ownerId: "owner-a",
        acquireDeferredManagedAiAdmission: acquire,
      },
      enabled: true,
      schedule: (callback) => { task = callback; },
      work,
      onError,
    })).toBe(true);
    expect(acquire).not.toHaveBeenCalled();
    const running = task?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(acquire).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(MANAGED_AI_DEFERRED_ADMISSION_DEADLINE_MS);
    await running;
    expect(admissionSignal?.aborted).toBe(true);
    expect(work).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("contains deferred work and release failures without releasing twice", async () => {
    let task: (() => void | Promise<void>) | undefined;
    const release = vi.fn().mockRejectedValue(new Error("private release detail"));
    const onError = vi.fn();

    expect(await scheduleManagedAiDeferredWork({
      authorization: {
        mode: "cloud",
        ownerId: "owner-a",
        admissionId: "primary-admission",
        releaseExternalWork: vi.fn(),
        acquireDeferredManagedAiAdmission: vi.fn().mockResolvedValue({ release }),
      },
      enabled: true,
      schedule: (callback) => { task = callback; },
      work: async () => { throw new Error("private provider detail"); },
      onError,
    })).toBe(true);

    await expect(task?.()).resolves.toBeUndefined();
    expect(release).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledTimes(2);
  });
});
