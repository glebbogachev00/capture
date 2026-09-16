import { ownerPrecondition } from "./ownerPrecondition";
import { createHash, randomUUID } from "node:crypto";
import { isSafeImageId } from "@/lib/imgSync";
import { getCloudConfig } from "@/lib/supabase/config";
import { createCloudServerClient } from "@/lib/supabase/server";
import { identityFromClaims } from "@/lib/supabase/identity";

const MAX_SOURCE_BYTES = 3_000_000;
const MAX_REQUEST_BYTES = MAX_SOURCE_BYTES + 1024;
const MAX_IMAGE_BYTES = 2_250_000;

class ImageInputError extends Error {
  constructor(readonly status: number) { super("invalid image"); }
}

// Validate raster signatures as well as the MIME declaration. SVG/HTML and
// non-canonical base64 never enter Storage or get returned as a data URL.
function rasterMatches(bytes: Buffer, mime: string): boolean {
  if (mime === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/webp") return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (mime === "image/gif") return ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6));
  return false;
}

async function readImage(request: Request): Promise<{ bytes: Buffer; contentType: string }> {
  if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES) throw new ImageInputError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new ImageInputError(400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new ImageInputError(413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ImageInputError(400); }
  const src = (body as { src?: unknown } | null)?.src;
  if (typeof src !== "string") throw new ImageInputError(400);
  if (Buffer.byteLength(src) > MAX_SOURCE_BYTES) throw new ImageInputError(413);
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,/.exec(src);
  if (!match) throw new ImageInputError(400);
  const encoded = src.slice(match[0].length);
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.toString("base64") !== encoded || !rasterMatches(bytes, match[1])) throw new ImageInputError(400);
  if (bytes.length > MAX_IMAGE_BYTES) throw new ImageInputError(413);
  return { bytes, contentType: match[1] };
}

function storageCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

type Publication = { candidate_id: string; sha256: string; content_type: string; byte_size: number };
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function reply(request: Request, status: number, body: unknown): Response {
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
    status,
    headers: { "Cache-Control": "private, no-store", "Content-Type": "application/json" },
  });
}

export async function handleCloudImage(request: Request, id: string): Promise<Response> {
  try {
    const config = getCloudConfig();
    if (config?.status !== "ready") return reply(request, 503, { error: "cloud is not configured" });
    const client = await createCloudServerClient(config);
    const identity = await identityFromClaims(client);
    if (!identity) return reply(request, 401, { error: "unauthorized" });
    const precondition = ownerPrecondition(request, identity.userId);
    if (precondition) return precondition;
    // Images always require paid access, including direct Storage calls via RLS.
    const { data, error } = await client.from("capture_cloud_subscriptions")
      .select("polar_subscription_id").eq("user_id", identity.userId)
      .eq("is_entitled", true).gt("access_expires_at", new Date().toISOString()).limit(1);
    if (error) throw new Error("entitlement unavailable");
    if (!Array.isArray(data) || !data.length) return reply(request, 402, { error: "Cloud subscription required" });
    if (!isSafeImageId(id) || !isSafeImageId(identity.userId)) return reply(request, 400, { error: "bad id" });
    // No compatibility fallback to the broken provider create-only protocol.
    // Explicit DB mode: fresh namespace or separately verified legacy cutover.
    // Neither a missing schema nor installing inactive stage 1 allows storage.
    const gate = await client.rpc("capture_image_publication_ready");
    if (gate.error || gate.data !== true) throw new Error("image publication migration required");
    const settings = await client.rpc("capture_image_publication_config");
    const mode = settings.data?.mode;
    const candidateBucket = settings.data?.bucket;
    if (settings.error || !((mode === "fresh" && candidateBucket === "capture-image-candidates-fresh-20260914")
      || (mode === "legacy-cutover" && candidateBucket === "capture-image-candidates"))) throw new Error("publication mode mismatch");
    const input = request.method === "PUT" ? await readImage(request) : null;
    const lookup = async (): Promise<Publication | null> => {
      const result = await client.from("capture_image_publications")
        .select("candidate_id,sha256,content_type,byte_size")
        .eq("user_id", identity.userId).eq("image_id", id).maybeSingle();
      if (result.error) throw new Error("publication lookup failed");
      return result.data as Publication | null;
    };
    const read = async (publication: Publication | null) => {
      if (!publication && mode === "fresh") return null;
      if (publication && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(publication.candidate_id)) throw new Error("invalid publication");
      const bucket = client.storage.from(publication ? candidateBucket : "capture-images");
      const result = await bucket.download(`${identity.userId}/${publication?.candidate_id ?? id}`);
      // Only an absent frozen legacy object means a fresh logical ID. A dangling
      // publication is unavailable, never 404 and never permission to overwrite.
      if (!publication && storageCode(result.error) === "NoSuchKey") return null;
      if (result.error || !result.data || result.data.size > MAX_IMAGE_BYTES) throw new Error("image read failed");
      const bytes = Buffer.from(await result.data.arrayBuffer());
      const contentType = result.data.type;
      if (!rasterMatches(bytes, contentType)) throw new Error("invalid stored image");
      if (publication && (publication.sha256 !== digest(bytes) || publication.content_type !== contentType || publication.byte_size !== bytes.length)) throw new Error("publication bytes changed");
      return { bytes, contentType };
    };
    const publication = await lookup();
    if (request.method === "HEAD") {
      if (!publication && mode === "fresh") return reply(request, 404, { error: "not here" });
      if (publication && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(publication.candidate_id)) throw new Error("invalid publication");
      const result = await client.storage.from(publication ? candidateBucket : "capture-images")
        .info(`${identity.userId}/${publication?.candidate_id ?? id}`);
      if (!publication && storageCode(result.error) === "NoSuchKey") return reply(request, 404, { error: "not here" });
      const info = result.data;
      if (result.error || !info || !Number.isInteger(info.size) || !info.size || info.size < 0 || info.size > MAX_IMAGE_BYTES
        || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(info.contentType ?? "")
        || (publication && (info.size !== publication.byte_size || info.contentType !== publication.content_type))) throw new Error("image metadata unavailable");
      // Existence only, NOT a digest attestation. Same-size/MIME corruption can
      // pass HEAD; GET and every PUT acknowledgment still validate actual bytes.
      return reply(request, 204, null);
    }
    const existing = await read(publication);
    if (existing) {
      if (input) return reply(request, 200, { ok: true, stored: false });
      return reply(request, 200, { src: `data:${existing.contentType};base64,${existing.bytes.toString("base64")}` });
    }
    if (!input) return reply(request, 404, { error: "not here" });
    const candidate: Publication = {
      candidate_id: randomUUID(), sha256: digest(input.bytes),
      content_type: input.contentType, byte_size: input.bytes.length,
    };
    const uploaded = await client.storage.from(candidateBucket).upload(
      `${identity.userId}/${candidate.candidate_id}`, input.bytes,
      { upsert: false, contentType: input.contentType, cacheControl: "0" },
    );
    if (uploaded.error || !uploaded.data) throw new Error("candidate upload failed");
    await read(candidate);
    // Plain INSERT is the durable cross-instance arbiter. Never reuse a candidate,
    // upsert a pointer, or delete losers: ambiguous commits/crashes are retry-safe.
    const published = await client.from("capture_image_publications").insert({
      user_id: identity.userId, image_id: id, ...candidate,
    });
    if (published.error && published.error.code !== "23505") throw new Error("publication failed");
    const winner = await lookup();
    if (!winner || (!published.error && winner.candidate_id !== candidate.candidate_id)) throw new Error("publication not visible");
    await read(winner);
    return reply(request, 200, { ok: true, stored: !published.error });
  } catch (error) {
    if (error instanceof ImageInputError) return reply(request, error.status, { error: error.status === 413 ? "too large" : "bad request" });
    return reply(request, 503, { error: "image storage is unavailable" });
  }
}
