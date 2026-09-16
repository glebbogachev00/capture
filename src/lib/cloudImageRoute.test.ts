import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  identity: null as { userId: string } | null,
  entitled: true,
  configured: true,
  hub: vi.fn(),
  objects: new Map<string, Blob>(),
  info: vi.fn(), download: vi.fn(), upload: vi.fn(),
  subscriptions: vi.fn(),
  publications: new Map<string, Record<string, unknown>>(),
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
vi.mock("@/lib/hubStore", () => ({ hubStore: state.hub }));
vi.mock("@/lib/limiter", () => ({ limitFromEnv: () => 120, rateLimit: () => ({ allowed: true }) }));
import { GET, HEAD, PUT } from "@/app/api/img/[id]/route";

const src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=";
function call(method: "GET" | "HEAD" | "PUT", id = "photo", body = JSON.stringify({ src }), headers = {}) {
  return { GET, HEAD, PUT }[method](new Request(`https://capture.test/api/img/${id}?userId=victim`, {
    method, headers: { "X-Capture-Owner": state.identity?.userId ?? "anonymous", "Content-Type": "application/json", ...headers }, ...(method === "PUT" ? { body } : {}),
  }), { params: Promise.resolve({ id }) });
}
beforeEach(() => {
  vi.stubEnv("CAPTURE_CLOUD", "1");
  state.identity = null;
  state.entitled = true;
  state.configured = true;
  state.objects.clear();
  state.publications.clear();
  state.ready = true;
  state.mode = "legacy-cutover";
  state.bucket = "capture-image-candidates";
  state.buckets = [];
  state.publishFailure = null;
  vi.resetAllMocks();
  state.rpc.mockImplementation(async (name: string) => ({ data: name === "capture_image_publication_config" ? { mode: state.mode, bucket: state.bucket } : state.ready, error: null }));
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
    expect(await (await call("PUT")).json()).toEqual({ ok: true, stored: false });
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
  it("bounds the actual request stream even without Content-Length", async () => {
    state.identity = { userId: "alice" };
    expect((await call("PUT", "photo", JSON.stringify({ src: "x".repeat(3_000_001) }))).status).toBe(413);
    expect((await call("PUT", "photo", " ".repeat(3_001_025))).status).toBe(413);
    expect((await call("PUT", "photo", JSON.stringify({ src }), { "Content-Length": "9000000" })).status).toBe(413);
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("recovers an immutable photo only inside the verified user's namespace", async () => {
    state.identity = { userId: "alice" };
    expect((await call("HEAD")).status).toBe(404);
    expect((await call("PUT")).status).toBe(200);
    expect(await (await call("PUT")).json()).toEqual({ ok: true, stored: false });
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
  expect(await (await uploading).json()).toEqual({ ok: true, stored: true });
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
  expect(await (await call("PUT")).json()).toEqual({ ok: true, stored: false });
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
  expect(await (await call("PUT")).json()).toEqual({ ok: true, stored: true });
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
  expect(await (await call("PUT")).json()).toEqual({ ok: true, stored: false });
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
