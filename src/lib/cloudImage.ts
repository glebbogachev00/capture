import { ownerPrecondition } from "./ownerPrecondition";
import { createHash } from "node:crypto";
import { isSafeImageId } from "@/lib/imgSync";
import { getCloudConfig } from "@/lib/supabase/config";
import { createCloudServerClient } from "@/lib/supabase/server";
import { createCloudServiceClient } from "@/lib/supabase/service";
import { identityFromClaims } from "@/lib/supabase/identity";
import { consumeQuotaWithRpc } from "@/lib/cloudRequestGuard";
import { hasCurrentCloudAccess } from "@/lib/cloudAccess.server";

const SUPPORTED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MAX_IMAGE_BYTES = 2_250_000;
const MAX_ENCODED_IMAGE_BYTES = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);
const MAX_DATA_URL_PREFIX_BYTES = Math.max(...SUPPORTED_IMAGE_MIMES.map(
  mime => Buffer.byteLength(`data:${mime};base64,`),
));
export const MAX_SOURCE_BYTES = MAX_DATA_URL_PREFIX_BYTES + MAX_ENCODED_IMAGE_BYTES;
// JSON.stringify({ src }) adds exactly {"src":""} around canonical base64.
// Keep the route envelope exact rather than granting arbitrary extra body space.
export const MAX_REQUEST_BYTES = MAX_SOURCE_BYTES + Buffer.byteLength(JSON.stringify({ src: "" }));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
type Reservation = {
  operationId: string;
  leaseId: string;
  candidateId: string;
  bucket: string;
  objectPath: string;
  sha256: string;
  contentType: string;
  byteSize: number;
};
type Finalization = { status: "published" | "abandoned"; winner: ReservationWinner };
type ReservationWinner = {
  candidateId: string;
  bucket: string;
  objectPath: string;
  sha256: string;
  contentType: string;
  byteSize: number;
};

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const attestation = (bytes: Buffer, mime: string) => ({ digest: digest(bytes), mime, length: bytes.length });
const isMime = (value: unknown): value is string => ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(String(value));

function publicationFrom(value: unknown): Publication | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.candidate_id !== "string" || !UUID.test(row.candidate_id)
      || typeof row.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.sha256)
      || !isMime(row.content_type) || !Number.isSafeInteger(row.byte_size)
      || (row.byte_size as number) < 1 || (row.byte_size as number) > MAX_IMAGE_BYTES) return null;
  return row as Publication;
}

function winnerFrom(value: unknown): ReservationWinner | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.candidateId !== "string" || !UUID.test(row.candidateId)
      || typeof row.bucket !== "string" || typeof row.objectPath !== "string"
      || typeof row.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.sha256)
      || !isMime(row.contentType) || !Number.isSafeInteger(row.byteSize)
      || (row.byteSize as number) < 1 || (row.byteSize as number) > MAX_IMAGE_BYTES) return null;
  return row as ReservationWinner;
}

function reservationFrom(value: unknown, ownerId: string, input: { bytes: Buffer; contentType: string }, expectedBucket: string): Reservation | "quota" | "published" | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.status === "quota_exceeded") return "quota";
  if (row.status === "published") return "published";
  if (row.status !== "reserved" || typeof row.operationId !== "string" || !UUID.test(row.operationId)
      || typeof row.leaseId !== "string" || !UUID.test(row.leaseId)
      || typeof row.candidateId !== "string" || !UUID.test(row.candidateId)
      || row.bucket !== expectedBucket || row.objectPath !== `${ownerId}/${row.candidateId}`
      || row.sha256 !== digest(input.bytes) || row.contentType !== input.contentType
      || row.byteSize !== input.bytes.length) return null;
  return row as Reservation;
}

function finalizationFrom(value: unknown, ownerId: string, expectedBucket: string): Finalization | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const winner = winnerFrom(row.winner);
  if ((row.status !== "published" && row.status !== "abandoned") || !winner
      || winner.bucket !== expectedBucket || winner.objectPath !== `${ownerId}/${winner.candidateId}`) return null;
  return { status: row.status, winner };
}

function reply(request: Request, status: number, body: unknown, headers?: HeadersInit): Response {
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
    status,
    headers: { "Cache-Control": "private, no-store", "Content-Type": "application/json", ...headers },
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
    const lifecycle = await client.rpc("capture_account_deleting", { p_user_id: identity.userId });
    if (lifecycle.error || typeof lifecycle.data !== "boolean") throw new Error("account lifecycle unavailable");
    if (lifecycle.data) return reply(request, 403, { error: "account unavailable" });
    const backupRead = request.method !== "PUT" && new URL(request.url).searchParams.get("backup") === "1";
    if (backupRead) {
      const quota = await consumeQuotaWithRpc(client, identity.userId, { scope: "backup_read" });
      if (!quota.allowed) return reply(request, 429, { error: "quota exceeded" }, {
        "Retry-After": String(Math.max(1, quota.retryAfterSec)),
      });
    } else {
      // Ordinary image reads and every write remain current Cloud access.
      if (!await hasCurrentCloudAccess(client, identity.userId)) {
        return reply(request, 402, { error: "Capture Cloud access required" });
      }
    }
    if (!isSafeImageId(id) || !isSafeImageId(identity.userId)) return reply(request, 400, { error: "bad id" });

    const gate = await client.rpc("capture_image_publication_ready");
    const admissionGate = await client.rpc("capture_image_admission_ready");
    if (gate.error || gate.data !== true || admissionGate.error || admissionGate.data !== true) {
      throw new Error("image admission migration required");
    }
    const settings = await client.rpc("capture_image_publication_config");
    const mode = settings.data?.mode;
    const candidateBucket = settings.data?.bucket;
    if (settings.error || !((mode === "fresh" && candidateBucket === "capture-image-candidates-fresh-20260914")
      || (mode === "legacy-cutover" && candidateBucket === "capture-image-candidates"))) {
      throw new Error("publication mode mismatch");
    }

    const input = request.method === "PUT" ? await readImage(request) : null;
    const lookup = async (): Promise<Publication | null> => {
      const result = await client.from("capture_image_publications")
        .select("candidate_id,sha256,content_type,byte_size")
        .eq("user_id", identity.userId).eq("image_id", id).maybeSingle();
      if (result.error) throw new Error("publication lookup failed");
      const publication = result.data ? publicationFrom(result.data) : null;
      if (result.data && !publication) throw new Error("invalid publication");
      return publication;
    };
    const readObject = async (
      storageClient: typeof client,
      bucket: string,
      path: string,
      expected?: Publication | ReservationWinner | Reservation,
      allowAbsent = false,
    ) => {
      const result = await storageClient.storage.from(bucket).download(path);
      if (allowAbsent && storageCode(result.error) === "NoSuchKey") return null;
      if (result.error || !result.data || result.data.size > MAX_IMAGE_BYTES) throw new Error("image read failed");
      const bytes = Buffer.from(await result.data.arrayBuffer());
      const contentType = result.data.type;
      if (!rasterMatches(bytes, contentType)) throw new Error("invalid stored image");
      if (expected && (expected.sha256 !== digest(bytes)
        || ("content_type" in expected ? expected.content_type : expected.contentType) !== contentType
        || ("byte_size" in expected ? expected.byte_size : expected.byteSize) !== bytes.length)) {
        throw new Error("publication bytes changed");
      }
      return { bytes, contentType };
    };
    const readPublication = async (publication: Publication | null) => {
      if (!publication && mode === "fresh") return null;
      return readObject(
        client,
        publication ? candidateBucket : "capture-images",
        `${identity.userId}/${publication?.candidate_id ?? id}`,
        publication ?? undefined,
        !publication,
      );
    };

    const publication = await lookup();
    if (request.method === "HEAD") {
      if (!publication && mode === "fresh") return reply(request, 404, { error: "not here" });
      const result = await client.storage.from(publication ? candidateBucket : "capture-images")
        .info(`${identity.userId}/${publication?.candidate_id ?? id}`);
      if (!publication && storageCode(result.error) === "NoSuchKey") return reply(request, 404, { error: "not here" });
      const info = result.data;
      if (result.error || !info || !Number.isInteger(info.size) || !info.size || info.size < 0 || info.size > MAX_IMAGE_BYTES
        || !isMime(info.contentType)
        || (publication && (info.size !== publication.byte_size || info.contentType !== publication.content_type))) {
        throw new Error("image metadata unavailable");
      }
      return reply(request, 204, null);
    }

    const existing = await readPublication(publication);
    if (existing) {
      if (input) return reply(request, 200, { ok: true, stored: false, ...attestation(existing.bytes, existing.contentType) });
      return reply(request, 200, { src: `data:${existing.contentType};base64,${existing.bytes.toString("base64")}` });
    }
    if (!input) return reply(request, 404, { error: "not here" });

    const service = createCloudServiceClient(config);
    if (!service) throw new Error("image service unavailable");
    const reserved = await service.rpc("reserve_capture_image_storage", {
      p_owner_id: identity.userId,
      p_image_id: id,
      p_sha256: digest(input.bytes),
      p_content_type: input.contentType,
      p_byte_size: input.bytes.length,
    });
    if (reserved.error) throw new Error("image reservation failed");
    const reservation = reservationFrom(reserved.data, identity.userId, input, candidateBucket);
    if (reservation === "quota") return reply(request, 507, { error: "image storage quota exceeded" });
    if (reservation === "published") {
      const winner = await lookup();
      if (!winner) throw new Error("publication not visible");
      const verified = await readPublication(winner);
      if (!verified) throw new Error("publication readback missing");
      return reply(request, 200, { ok: true, stored: false, ...attestation(verified.bytes, verified.contentType) });
    }
    if (!reservation) throw new Error("invalid image reservation");

    let uploadStarted = false;
    try {
      uploadStarted = true;
      const uploaded = await service.storage.from(reservation.bucket).upload(
        reservation.objectPath,
        input.bytes,
        { upsert: false, contentType: input.contentType, cacheControl: "0" },
      );
      if (uploaded.error || !uploaded.data) {
        const recovered = await readObject(service as typeof client, reservation.bucket, reservation.objectPath, reservation, true);
        if (!recovered) throw new Error("candidate upload absent");
      } else {
        await readObject(service as typeof client, reservation.bucket, reservation.objectPath, reservation);
      }
      const recorded = await service.rpc("record_capture_image_storage_upload", {
        p_owner_id: identity.userId,
        p_operation_id: reservation.operationId,
        p_lease_id: reservation.leaseId,
      });
      if (recorded.error || recorded.data !== true) throw new Error("candidate upload recording failed");
      const finalized = await service.rpc("finalize_capture_image_storage", {
        p_owner_id: identity.userId,
        p_operation_id: reservation.operationId,
        p_lease_id: reservation.leaseId,
      });
      if (finalized.error) throw new Error("publication failed");
      const result = finalizationFrom(finalized.data, identity.userId, candidateBucket);
      if (!result) throw new Error("invalid publication result");
      const winner = await lookup();
      if (!winner || winner.candidate_id !== result.winner.candidateId
          || winner.sha256 !== result.winner.sha256 || winner.content_type !== result.winner.contentType
          || winner.byte_size !== result.winner.byteSize) throw new Error("publication not visible");
      const verified = await readObject(client, result.winner.bucket, result.winner.objectPath, result.winner);
      return reply(request, 200, {
        ok: true,
        stored: result.status === "published" && result.winner.candidateId === reservation.candidateId,
        ...attestation(verified!.bytes, verified!.contentType),
      });
    } catch (error) {
      const cleanupRpc = uploadStarted
        ? "abandon_capture_image_storage_reservation"
        : "release_capture_image_storage_reservation";
      const cleaned = await service.rpc(cleanupRpc, {
        p_owner_id: identity.userId,
        p_operation_id: reservation.operationId,
        p_lease_id: reservation.leaseId,
      });
      if (cleaned.error || cleaned.data !== true) throw new Error("image reservation cleanup failed");
      throw error;
    }
  } catch (error) {
    if (error instanceof ImageInputError) return reply(request, error.status, { error: error.status === 413 ? "too large" : "bad request" });
    return reply(request, 503, { error: "image storage is unavailable" });
  }
}
