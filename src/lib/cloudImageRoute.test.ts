import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  identity: null as { userId: string } | null,
  entitled: true,
  erasing: false,
  configured: true,
  hub: vi.fn(),
  objects: new Map<string, Blob>(),
  info: vi.fn(), download: vi.fn(), upload: vi.fn(),
  subscriptions: vi.fn(),
  publications: new Map<string, Record<string, unknown>>(),
  operations: new Map<string, Record<string, unknown>>(),
  ready: true,
  mode: "legacy-cutover",
  bucket: "capture-image-candidates",
  buckets: [] as string[],
  rpc: vi.fn(),
  publishFailure: null as "before" | "after" | "unreadable" | null,
}));
vi.mock("@/lib/supabase/config", () => ({ getCloudConfig: () => state.configured ? ({ status: "ready" }) : ({ status: "missing" }) }));
vi.mock("@/lib/supabase/identity", () => ({ identityFromClaims: async () => state.identity }));
vi.mock("@/lib/supabase/server", () => ({ createCloudServerClient: async () => ({
  from: state.subscriptions,
  rpc: state.rpc,
  storage: { from: (bucket: string) => {
    state.buckets.push(bucket);
    expect(["capture-images", "capture-image-candidates", "capture-image-candidates-fresh-20260914"]).toContain(bucket);
    return { info: state.info, download: state.download, upload: state.upload };
  } },
}) }));
vi.mock("@/lib/supabase/service", () => ({ createCloudServiceClient: () => ({
  from: state.subscriptions,
  rpc: state.rpc,
  storage: { from: (bucket: string) => {
    state.buckets.push(bucket);
    expect(["capture-images", "capture-image-candidates", "capture-image-candidates-fresh-20260914"]).toContain(bucket);
    return { info: state.info, download: state.download, upload: state.upload };
  } },
}) }));
vi.mock("@/lib/hubStore", () => ({ hubStore: state.hub }));
vi.mock("@/lib/limiter", () => ({ limitFromEnv: () => 120, rateLimit: () => ({ allowed: true }) }));
import { GET, HEAD, PUT } from "@/app/api/img/[id]/route";
import { MAX_IMAGE_BYTES, MAX_REQUEST_BYTES, MAX_SOURCE_BYTES } from "./cloudImage";

const src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=";
const imageAtSize = (mime: "image/png" | "image/jpeg" | "image/webp" | "image/gif", size: number) => {
  const bytes = Buffer.alloc(size);
  if (mime === "image/png") Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  if (mime === "image/jpeg") Buffer.from([255, 216, 255]).copy(bytes);
  if (mime === "image/webp") {
    Buffer.from("RIFF").copy(bytes, 0);
    Buffer.from("WEBP").copy(bytes, 8);
  }
  if (mime === "image/gif") Buffer.from("GIF89a").copy(bytes);
  return `data:${mime};base64,${bytes.toString("base64")}`;
};
function call(
  method: "GET" | "HEAD" | "PUT",
  id = "photo",
  body = JSON.stringify({ src }),
  headers = {},
  query = "userId=victim",
) {
  return { GET, HEAD, PUT }[method](new Request(`https://capture.test/api/img/${id}?${query}`, {
    method, headers: { "X-Capture-Owner": state.identity?.userId ?? "anonymous", "Content-Type": "application/json", ...headers }, ...(method === "PUT" ? { body } : {}),
  }), { params: Promise.resolve({ id }) });
}
beforeEach(() => {
  vi.stubEnv("CAPTURE_CLOUD", "1");
  state.identity = null;
  state.entitled = true;
  state.erasing = false;
  state.configured = true;
  state.objects.clear();
  state.publications.clear();
  state.operations.clear();
  state.ready = true;
  state.mode = "legacy-cutover";
  state.bucket = "capture-image-candidates";
  state.buckets = [];
  state.publishFailure = null;
  vi.resetAllMocks();
  state.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
    if (name === "capture_image_publication_config") return { data: { mode: state.mode, bucket: state.bucket }, error: null };
    if (name === "consume_capture_cloud_quota") return { data: { allowed: true, retryAfterSec: 0 }, error: null };
    if (name === "capture_account_deleting") return { data: state.erasing, error: null };
    if (name === "capture_image_publication_ready" || name === "capture_image_admission_ready") {
      return { data: state.ready, error: null };
    }
    if (name === "reserve_capture_image_storage") {
      const owner = String(args?.p_owner_id);
      const image = String(args?.p_image_id);
      const existing = state.publications.get(`${owner}/${image}`);
      if (existing) return { data: {
        status: "published", candidateId: existing.candidate_id,
        sha256: existing.sha256, contentType: existing.content_type,
        byteSize: existing.byte_size, bucket: state.bucket,
        objectPath: `${owner}/${existing.candidate_id}`,
      }, error: null };
      const operationId = crypto.randomUUID();
      const leaseId = crypto.randomUUID();
      const candidateId = crypto.randomUUID();
      const operation: Record<string, unknown> = {
        operationId, leaseId, candidateId, owner, image,
        bucket: state.bucket, objectPath: `${owner}/${candidateId}`,
        sha256: args?.p_sha256, contentType: args?.p_content_type,
        byteSize: args?.p_byte_size, state: "reserved",
      };
      state.operations.set(operationId, operation);
      return { data: { status: "reserved", ...operation }, error: null };
    }
    if (name === "record_capture_image_storage_upload") {
      const operation = state.operations.get(String(args?.p_operation_id));
      if (!operation || operation.leaseId !== args?.p_lease_id || !state.entitled) return { data: false, error: null };
      operation.state = "uploaded";
      return { data: true, error: null };
    }
    if (name === "abandon_capture_image_storage_reservation") {
      const operation = state.operations.get(String(args?.p_operation_id));
      if (!operation || operation.leaseId !== args?.p_lease_id) return { data: false, error: null };
      if (operation.state !== "published") operation.state = "abandoned";
      return { data: true, error: null };
    }
    if (name === "release_capture_image_storage_reservation") {
      const operation = state.operations.get(String(args?.p_operation_id));
      if (!operation || operation.leaseId !== args?.p_lease_id) return { data: false, error: null };
      operation.state = "released";
      return { data: true, error: null };
    }
    if (name === "finalize_capture_image_storage") {
      const operation = state.operations.get(String(args?.p_operation_id));
      if (!operation || operation.leaseId !== args?.p_lease_id || !state.entitled) return { data: null, error: { code: "42501" } };
      if (state.publishFailure === "before") return { data: null, error: { code: "offline" } };
      const key = `${operation.owner}/${operation.image}`;
      let winner = state.publications.get(key);
      if (!winner) {
        winner = {
          user_id: operation.owner, image_id: operation.image,
          candidate_id: operation.candidateId, sha256: operation.sha256,
          content_type: operation.contentType, byte_size: operation.byteSize,
        };
        state.publications.set(key, winner);
        operation.state = "published";
      } else operation.state = "abandoned";
      if (state.publishFailure === "unreadable") state.objects.delete(String(operation.objectPath));
      if (state.publishFailure === "after") return { data: null, error: { code: "response_lost" } };
      return { data: {
        status: operation.state,
        winner: {
          candidateId: winner.candidate_id, sha256: winner.sha256,
          contentType: winner.content_type, byteSize: winner.byte_size,
          bucket: state.bucket, objectPath: `${operation.owner}/${winner.candidate_id}`,
        },
      }, error: null };
    }
    return { data: null, error: { code: "PGRST202" } };
  });
  state.hub.mockReturnValue({ exists: async () => true, read: async () => ({ body: src }), write: async () => true });
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), gt: vi.fn().mockReturnThis(),
    limit: async () => ({ data: state.entitled ? [{ polar_subscription_id: "paid" }] : [], error: null }),
  };
  state.subscriptions.mockImplementation((table: string) => {
    if (table === "capture_cloud_subscriptions") return query;
    expect(table).toBe("capture_image_publications");
    const filters: Record<string, string> = {};
    return {
      select() { return this; },
      eq(key: string, value: string) { filters[key] = value; return this; },
      async maybeSingle() { return { data: state.publications.get(`${filters.user_id}/${filters.image_id}`) ?? null, error: null }; },
      async insert(row: Record<string, unknown>) {
        if (state.publishFailure === "before") return { error: { code: "offline" } };
        if (!state.entitled) return { error: { code: "42501" } };
        const key = `${row.user_id}/${row.image_id}`;
        if (state.publications.has(key)) return { error: { code: "23505" } };
        state.publications.set(key, row);
        if (state.publishFailure === "after") return { error: { code: "response_lost" } };
        if (state.publishFailure === "unreadable") state.objects.delete(`${row.user_id}/${row.candidate_id}`);
        return { error: null };
      },
    };
  });
  state.info.mockImplementation(async (path: string) => state.objects.has(path)
    ? { data: { size: state.objects.get(path)!.size, contentType: state.objects.get(path)!.type }, error: null }
    : { data: null, error: { code: "NoSuchKey", status: 404 } });
  state.download.mockImplementation(async (path: string) => state.entitled
    ? ({ data: state.objects.get(path) ?? null, error: state.objects.has(path) ? null : { code: "NoSuchKey" } })
    : ({ data: null, error: { code: "AccessDenied" } }));
  state.upload.mockImplementation(async (path: string, bytes: Uint8Array, options: { upsert: boolean; contentType: string }) => {
    expect(options.upsert).toBe(false);
    if (state.objects.has(path)) return { data: null, error: { code: "ResourceAlreadyExists", status: 409 } };
    state.objects.set(path, new Blob([new Uint8Array(bytes)], { type: options.contentType }));
    return { data: { path }, error: null };
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("Cloud image resource boundary", () => {
  it("derives the narrow data-URL and JSON envelopes from the decoded byte ceiling", () => {
    expect(MAX_IMAGE_BYTES).toBe(2_250_000);
    expect(MAX_SOURCE_BYTES).toBe(3_000_023);
    expect(MAX_REQUEST_BYTES).toBe(3_000_033);
  });

  it.each(["GET", "HEAD", "PUT"] as const)("%s rejects old and mismatched clients before entitlement/storage access", async (method) => {
    state.identity = { userId: "bob" };
    for (const owner of [undefined, "alice", "anonymous"]) {
      const request = new Request("https://capture.test/api/img/photo?userId=bob", {
        method, headers: owner ? { "X-Capture-Owner": owner } : {},
        ...(method === "PUT" ? { body: JSON.stringify({ src }) } : {}),
      });
      const result = await { GET, HEAD, PUT }[method](request, { params: Promise.resolve({ id: "photo" }) });
      expect(result.status).toBe(owner === undefined ? 428 : 412);
      expect(result.headers.get("cache-control")).toContain("no-store");
    }
    expect(state.subscriptions).not.toHaveBeenCalled();
    expect(state.info).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
    expect(state.upload).not.toHaveBeenCalled();
    expect(state.hub).not.toHaveBeenCalled();
  });
  it.each(["GET", "HEAD", "PUT"] as const)("%s never falls back when Cloud is misconfigured", async (method) => {
    state.configured = false;
    expect((await call(method)).status).toBe(503);
    expect(state.hub).not.toHaveBeenCalled();
  });
  it.each([
    { code: "KeyAlreadyExists", status: 409 },
    { status: 400, statusCode: "409", message: "The resource already exists" },
  ])("recovers a published duplicate without attempting another Storage upload %j", async (error) => {
    state.identity = { userId: "alice" };
    await call("PUT");
    state.upload.mockResolvedValueOnce({ data: null, error });
    expect(await (await call("PUT")).json()).toMatchObject({ ok: true, stored: false });
    expect(state.upload).toHaveBeenCalledTimes(1);
  });
  it("never returns unvalidated bytes uploaded directly to Storage", async () => {
    state.identity = { userId: "alice" };
    state.objects.set("alice/photo", new Blob(["<script>bad</script>"], { type: "image/png" }));
    expect((await call("GET")).status).toBe(503);
    state.objects.set("alice/photo", new Blob([new Uint8Array(2_250_001)], { type: "image/png" }));
    expect((await call("GET")).status).toBe(503);
  });
  it.each(["GET", "HEAD", "PUT"] as const)("%s fails closed on provider failures", async (method) => {
    state.identity = { userId: "alice" };
    for (const error of [{ code: "NoSuchBucket", status: 404 }, { status: 404 }, { code: "AccessDenied", status: 403 }, { status: 500 }]) {
      state.info.mockResolvedValue({ data: null, error });
      state.download.mockResolvedValue({ data: null, error });
      state.upload.mockResolvedValue({ data: null, error });
      expect((await call(method)).status).toBe(503);
    }
    expect(state.hub).not.toHaveBeenCalled();
  });
  it("does not acknowledge a duplicate that cannot be read", async () => {
    state.identity = { userId: "alice" };
    state.upload.mockResolvedValue({ data: null, error: { code: "ResourceAlreadyExists" } });
    expect((await call("PUT")).status).toBe(503);
  });
  it("fails closed on entitlement query failure", async () => {
    state.identity = { userId: "alice" };
    state.subscriptions.mockImplementation(() => { throw new Error("offline"); });
    expect((await call("GET")).status).toBe(503);
    expect(state.download).not.toHaveBeenCalled();
  });

  it.each(["GET", "HEAD", "PUT"] as const)("%s denies an erasing owner before entitlement or storage", async (method) => {
    state.identity = { userId: "alice" };
    state.erasing = true;
    expect((await call(method)).status).toBe(403);
    expect(state.subscriptions).not.toHaveBeenCalled();
    expect(state.info).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
    expect(state.upload).not.toHaveBeenCalled();
  });

  it.each(["GET", "HEAD"] as const)("%s denies backup image reads after confirmation installs the deletion fence", async (method) => {
    state.identity = { userId: "alice" };
    state.erasing = true;
    expect((await call(method, "photo", JSON.stringify({ src }), {}, "backup=1")).status).toBe(403);
    expect(state.rpc).toHaveBeenCalledWith("capture_account_deleting", { p_user_id: "alice" });
    expect(state.rpc).not.toHaveBeenCalledWith("consume_capture_cloud_quota", expect.anything());
    expect(state.info).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
  });

  it.each(["GET", "HEAD", "PUT"] as const)("%s rejects path injection before storage", async (method) => {
    state.identity = { userId: "alice" };
    for (const id of ["../bob/photo", "bob/photo", "", "a".repeat(65), "x%2Fy"]) {
      expect((await call(method, id)).status, id).toBe(400);
    }
    expect(state.info).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
    expect(state.upload).not.toHaveBeenCalled();
  });
  it.each([
    "null", "[]", "{", "{}", JSON.stringify({ src: 1 }),
    JSON.stringify({ src: "data:text/html;base64,PHNjcmlwdD4=" }),
    JSON.stringify({ src: "data:image/svg+xml;base64,PHN2Zz4=" }),
    JSON.stringify({ src: "data:image/png;base64,not!base64" }),
    JSON.stringify({ src: "data:image/png;base64,aGVsbG8=" }),
  ])("rejects malformed or non-raster payload %s", async (body) => {
    state.identity = { userId: "alice" };
    expect((await call("PUT", "photo", body)).status).toBe(400);
    expect(state.upload).not.toHaveBeenCalled();
  });
  it("accepts exactly 2,250,000 decoded bytes and rejects 2,250,001 for every supported MIME", async () => {
    state.identity = { userId: "alice" };
    const mimes = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
    for (const [index, mime] of mimes.entries()) {
      const accepted = imageAtSize(mime, 2_250_000);
      const response = await call("PUT", `at-limit-${index}`, JSON.stringify({ src: accepted }));
      expect(response.status, mime).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, length: 2_250_000, mime });

      const rejected = imageAtSize(mime, 2_250_001);
      expect((await call("PUT", `over-limit-${index}`, JSON.stringify({ src: rejected }))).status, mime).toBe(413);
    }
  });

  it("bounds the actual request stream even without Content-Length", async () => {
    state.identity = { userId: "alice" };
    expect((await call("PUT", "photo", JSON.stringify({ src: "x".repeat(MAX_SOURCE_BYTES + 1) }))).status).toBe(413);
    expect((await call("PUT", "photo", " ".repeat(MAX_REQUEST_BYTES + 1))).status).toBe(413);
    expect((await call("PUT", "photo", JSON.stringify({ src }), { "Content-Length": String(MAX_REQUEST_BYTES + 1) })).status).toBe(413);
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("reserves exact owner bytes before touching Storage and never lets the request choose a candidate path", async () => {
    state.identity = { userId: "alice" };
    const response = await call("PUT", "photo");
    expect(response.status).toBe(200);
    const reserveOrder = state.rpc.mock.invocationCallOrder[
      state.rpc.mock.calls.findIndex(([name]) => name === "reserve_capture_image_storage")
    ];
    expect(state.rpc).toHaveBeenCalledWith("reserve_capture_image_storage", {
      p_owner_id: "alice",
      p_image_id: "photo",
      p_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_content_type: "image/png",
      p_byte_size: expect.any(Number),
    });
    expect(reserveOrder).toBeLessThan(state.upload.mock.invocationCallOrder[0]);
    expect(state.upload.mock.calls[0]?.[0]).toMatch(/^alice\/[0-9a-f-]{36}$/i);
  });

  it("returns a fixed quota denial before upload when PostgreSQL refuses capacity", async () => {
    state.identity = { userId: "alice" };
    const rpc = state.rpc.getMockImplementation()!;
    state.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => name === "reserve_capture_image_storage"
      ? { data: { status: "quota_exceeded" }, error: null }
      : rpc(name, args));
    const response = await call("PUT", "photo");
    expect(response.status).toBe(507);
    expect(await response.json()).toEqual({ error: "image storage quota exceeded" });
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("abandons but keeps capacity after typed absence because an admitted completion may still land", async () => {
    state.identity = { userId: "alice" };
    state.upload.mockResolvedValue({ data: null, error: { code: "UploadFailed" } });
    const response = await call("PUT", "photo");
    expect(response.status).toBe(503);
    expect(state.rpc).toHaveBeenCalledWith("abandon_capture_image_storage_reservation", expect.objectContaining({
      p_owner_id: "alice",
      p_operation_id: expect.any(String),
      p_lease_id: expect.any(String),
    }));
    expect([...state.operations.values()][0].state).toBe("abandoned");
  });

  it("retains accounting on an ambiguous upload failure instead of releasing unsafely", async () => {
    state.identity = { userId: "alice" };
    state.mode = "fresh";
    state.bucket = "capture-image-candidates-fresh-20260914";
    state.upload.mockResolvedValue({ data: null, error: { code: "GatewayUnavailable" } });
    state.download.mockResolvedValue({ data: null, error: { code: "GatewayUnavailable" } });
    expect((await call("PUT", "photo")).status).toBe(503);
    expect(state.rpc).not.toHaveBeenCalledWith("release_capture_image_storage_reservation", expect.anything());
    expect(state.rpc).toHaveBeenCalledWith("abandon_capture_image_storage_reservation", expect.anything());
    expect([...state.operations.values()][0].state).toBe("abandoned");
  });

  it("recovers a lost upload response by validating the exact reserved candidate", async () => {
    state.identity = { userId: "alice" };
    state.upload.mockImplementation(async (path: string, bytes: Uint8Array, options: { contentType: string }) => {
      state.objects.set(path, new Blob([new Uint8Array(bytes)], { type: options.contentType }));
      return { data: null, error: { code: "ResponseLost" } };
    });
    const response = await call("PUT", "photo");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, stored: true });
    expect(state.rpc).not.toHaveBeenCalledWith("release_capture_image_storage_reservation", expect.anything());
  });

  it("recovers an immutable photo only inside the verified user's namespace", async () => {
    state.identity = { userId: "alice" };
    expect((await call("HEAD")).status).toBe(404);
    const stored = await call("PUT");
    expect(stored.status).toBe(200);
    expect(await stored.json()).toMatchObject({
      ok: true,
      stored: true,
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      mime: "image/png",
      length: expect.any(Number),
    });
    expect(await (await call("PUT")).json()).toMatchObject({ ok: true, stored: false });
    const head = await call("HEAD");
    expect(head.status).toBe(204);
    expect(await head.text()).toBe("");
    expect(state.download).toHaveBeenCalledWith("alice/photo");
    const query = state.subscriptions.mock.results[0].value;
    expect(query.eq).toHaveBeenCalledWith("user_id", "alice");
    expect(query.eq).toHaveBeenCalledWith("is_entitled", true);
    expect(query.gt).toHaveBeenCalledWith("access_expires_at", expect.any(String));
    const recovered = await call("GET");
    expect(await recovered.json()).toEqual({ src });
    expect(recovered.headers.get("Cache-Control")).toBe("private, no-store");
    state.identity = { userId: "bob" };
    expect((await call("GET")).status).toBe(404);
    expect((await call("HEAD")).status).toBe(404);
    expect((await call("PUT")).status).toBe(200);
    expect([...state.objects.keys()]).toHaveLength(2);
    expect([...state.publications.keys()]).toEqual(["alice/photo", "bob/photo"]);
    expect(state.hub).not.toHaveBeenCalled();
  });
  it.each(["GET", "HEAD", "PUT"] as const)("%s denies unpaid callers even with the board subscription override", async (method) => {
    state.identity = { userId: "alice" };
    state.entitled = false;
    vi.stubEnv("CAPTURE_CLOUD_REQUIRE_SUBSCRIPTION", "0");
    expect((await call(method)).status).toBe(402);
    expect(state.hub).not.toHaveBeenCalled();
    expect(state.info).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
    expect(state.upload).not.toHaveBeenCalled();
  });
  it.each([undefined, "0"])("allows exact-owner quota-bounded backup reads after billing expiry with subscription switch %s", async (subscriptionSwitch) => {
    state.identity = { userId: "alice" };
    expect((await call("PUT")).status).toBe(200);
    state.entitled = false;
    if (subscriptionSwitch !== undefined) {
      vi.stubEnv("CAPTURE_CLOUD_REQUIRE_SUBSCRIPTION", subscriptionSwitch);
    }
    state.subscriptions.mockClear();
    state.rpc.mockClear();
    state.download.mockImplementation(async (path: string) => ({
      data: state.objects.get(path) ?? null,
      error: state.objects.has(path) ? null : { code: "NoSuchKey" },
    }));

    expect((await call("GET")).status).toBe(402);
    expect((await call("PUT")).status).toBe(402);
    state.subscriptions.mockClear();
    const recovery = await call("GET", "photo", JSON.stringify({ src }), {}, "backup=1");
    expect(recovery.status).toBe(200);
    expect(await recovery.json()).toEqual({ src });
    expect(state.subscriptions.mock.calls.map(([table]) => table))
      .not.toContain("capture_cloud_subscriptions");
    expect(state.rpc).toHaveBeenCalledWith("consume_capture_cloud_quota", { p_scope: "backup_read" });
  });

  it.each(["GET", "HEAD", "PUT"] as const)("%s denies anonymous callers without touching either store", async (method) => {
    const res = await call(method);
    expect(res.status).toBe(401);
    expect(state.hub).not.toHaveBeenCalled();
    expect(state.info).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
    expect(state.upload).not.toHaveBeenCalled();
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

it.each(["legacy-cutover", "fresh"])("%s has one durable winner across independent requests even when provider admits both uploads", async (mode) => {
  state.mode = mode;
  if (mode === "fresh") state.bucket = "capture-image-candidates-fresh-20260914";
  state.identity = { userId: "alice" };
  let arrivals = 0;
  let release!: () => void;
  const admitted = new Promise<void>(resolve => { release = resolve; });
  state.upload.mockImplementation(async (path: string, bytes: Uint8Array, options: { contentType: string }) => {
    if (++arrivals === 2) release();
    await admitted;
    state.objects.set(path, new Blob([new Uint8Array(bytes)], { type: options.contentType }));
    return { data: { path }, error: null };
  });
  const gif = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  vi.resetModules();
  const otherInstance = await import("./cloudImage");
  const responses = await Promise.all([call("PUT"), otherInstance.handleCloudImage(new Request("https://capture.test/api/img/photo", {
    method: "PUT", headers: { "X-Capture-Owner": "alice" }, body: JSON.stringify({ src: gif }),
  }), "photo")]);
  const bodies = await Promise.all(responses.map(r => r.json()));
  expect(responses.map(r => r.status)).toEqual([200, 200]);
  expect(bodies.filter(b => b.stored === true)).toHaveLength(1);
  expect(bodies.filter(b => b.stored === false)).toHaveLength(1);
  expect(state.objects.size).toBe(2);
  for (let i = 0; i < 2; i++) expect(await (await call("GET")).json()).toEqual({ src: [src, gif][bodies.findIndex(b => b.stored)] });
});

it.each([false, "missing"])("fails closed before touching storage when migration gate is %s", async (gate) => {
  state.identity = { userId: "alice" };
  state.rpc.mockResolvedValue({ data: gate === false ? false : null, error: gate === "missing" ? { code: "PGRST202" } : null });
  for (const method of ["GET", "HEAD", "PUT"] as const) expect((await call(method)).status).toBe(503);
  expect(state.download).not.toHaveBeenCalled();
  expect(state.upload).not.toHaveBeenCalled();
});

it("fresh ignores old objects and late old-namespace completions for HEAD GET PUT", async () => {
  state.identity = { userId: "alice" };
  state.mode = "fresh";
  state.bucket = "capture-image-candidates-fresh-20260914";
  state.objects.set("alice/photo", new Blob(["old"], { type: "image/png" }));
  expect((await call("HEAD")).status).toBe(404);
  expect((await call("GET")).status).toBe(404);
  expect(state.buckets).toEqual([]);
  const uploading = call("PUT");
  state.objects.set("alice/photo", new Blob(["late old completion"], { type: "image/gif" }));
  expect(await (await uploading).json()).toMatchObject({ ok: true, stored: true });
  expect(await (await call("GET")).json()).toEqual({ src });
  expect(new Set(state.buckets)).toEqual(new Set([state.bucket]));
});

it.each([["fresh", "capture-image-candidates"], ["legacy-cutover", "capture-image-candidates-fresh-20260914"], ["inactive", "capture-image-candidates"]])("rejects mixed publication config %s %s", async (mode, bucket) => {
  state.identity = { userId: "alice" };
  state.mode = mode;
  state.bucket = bucket;
  for (const method of ["HEAD", "GET", "PUT"] as const) expect((await call(method)).status).toBe(503);
  expect(state.buckets).toEqual([]);
});

it("preserves frozen legacy links without creating a competing publication", async () => {
  state.identity = { userId: "alice" };
  state.objects.set("alice/photo", new Blob([Buffer.from(src.split(",")[1], "base64")], { type: "image/png" }));
  expect((await call("HEAD")).status).toBe(204);
  expect(await (await call("PUT")).json()).toMatchObject({ ok: true, stored: false });
  expect(await (await call("GET")).json()).toEqual({ src });
  expect(state.upload).not.toHaveBeenCalled();
  expect(state.publications.size).toBe(0);
});

it.each(["legacy-cutover", "fresh"])("%s retries a crash before publication using a fresh candidate and retains the orphan", async (mode) => {
  state.mode = mode;
  if (mode === "fresh") state.bucket = "capture-image-candidates-fresh-20260914";
  state.identity = { userId: "alice" };
  state.publishFailure = "before";
  expect((await call("PUT")).status).toBe(503);
  expect(state.publications.size).toBe(0);
  const orphan = [...state.objects.keys()][0];
  state.publishFailure = null;
  expect(await (await call("PUT")).json()).toMatchObject({ ok: true, stored: true });
  expect(state.objects.size).toBe(2);
  expect(state.objects.has(orphan)).toBe(true);
  expect(await (await call("GET")).json()).toEqual({ src });
});

it("recovers a committed publication after response loss without another upload", async () => {
  state.identity = { userId: "alice" };
  state.publishFailure = "after";
  expect((await call("PUT")).status).toBe(503);
  expect(state.publications.size).toBe(1);
  state.publishFailure = null;
  expect(await (await call("PUT")).json()).toMatchObject({ ok: true, stored: false });
  expect(state.upload).toHaveBeenCalledTimes(1);
});

it("never acknowledges an unreadable publication or overwrites it on retry", async () => {
  state.identity = { userId: "alice" };
  state.publishFailure = "unreadable";
  expect((await call("PUT")).status).toBe(503);
  state.publishFailure = null;
  for (const method of ["GET", "HEAD", "PUT"] as const) expect((await call(method)).status).toBe(503);
  expect(state.publications.size).toBe(1);
  expect(state.upload).toHaveBeenCalledTimes(1);
});

it("detects valid-raster byte tampering rather than acknowledge different published bytes", async () => {
  state.identity = { userId: "alice" };
  expect((await call("PUT")).status).toBe(200);
  const key = [...state.objects.keys()][0];
  state.objects.set(key, new Blob([Buffer.concat([Buffer.from(src.split(",")[1], "base64"), Buffer.from("tampered")])], { type: "image/png" }));
  for (const method of ["GET", "HEAD", "PUT"] as const) expect((await call(method)).status).toBe(503);
  expect(state.upload).toHaveBeenCalledTimes(1);
});

it("uses metadata-only HEAD for both legacy and published images", async () => {
  state.identity = { userId: "alice" };
  state.objects.set("alice/legacy", new Blob([Buffer.from(src.split(",")[1], "base64")], { type: "image/png" }));
  expect((await call("PUT")).status).toBe(200);
  state.download.mockClear();
  for (const id of ["legacy", "photo"]) expect((await call("HEAD", id)).status).toBe(204);
  expect(state.download).not.toHaveBeenCalled();
  expect(state.info).toHaveBeenCalled();
});

it("HEAD is existence only; same-size same-MIME direct tampering fails closed on GET and PUT", async () => {
  state.identity = { userId: "alice" };
  expect((await call("PUT")).status).toBe(200);
  const key = [...state.objects.keys()][0];
  const bytes = Buffer.from(src.split(",")[1], "base64");
  bytes[bytes.length - 1] ^= 1;
  state.objects.set(key, new Blob([bytes], { type: "image/png" }));
  expect((await call("HEAD")).status).toBe(204);
  for (const method of ["GET", "PUT"] as const) expect((await call(method)).status).toBe(503);
  expect(state.upload).toHaveBeenCalledTimes(1);
});

it("does not publish or acknowledge when entitlement is revoked during upload", async () => {
  state.identity = { userId: "alice" };
  const upload = state.upload.getMockImplementation()!;
  state.upload.mockImplementation(async (...args) => {
    const result = await upload(...args);
    state.entitled = false;
    return result;
  });
  expect((await call("PUT")).status).toBe(503);
  expect(state.objects.size).toBe(1);
  expect(state.publications.size).toBe(0);
  expect((await call("GET")).status).toBe(402);
});
