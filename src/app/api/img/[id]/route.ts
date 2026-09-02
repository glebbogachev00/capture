import { NextResponse } from "next/server";
import { clientIp } from "@/lib/clientIp";
import { hubStore } from "@/lib/hubStore";
import { isSafeImageId } from "@/lib/imgSync";
import { limitFromEnv, rateLimit } from "@/lib/limiter";

/**
 * The photo hub.
 *
 * The board syncs as text — photo bytes live under their own keys on each
 * device — so a picture used to stop at the device that took it. This is
 * the exchange: one file per image id, written once and never rewritten.
 *
 * Immutable by construction: an id is minted at capture and the bytes under
 * it never change, so there is nothing to resolve when both devices hold the
 * same id. A PUT for an id that already exists is a no-op, which makes
 * re-uploading harmless and lets a device be simple-minded about what the
 * hub already has.
 *
 * Same storage as the sync hub next door — see lib/hubStore. That matters
 * here more than anywhere: this route wrote straight to disk, and a
 * serverless filesystem is read-only, so on a Vercel deployment every PUT
 * answered "write failed" and every GET answered 404. Photos have never
 * crossed between devices there. The board got away with it because its
 * store happened to keep a copy in memory; a photo had nothing to fall back
 * on.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One key per image id, under a folder of their own. */
const keyFor = (id: string) => `img/${id}`;

/** A shrunk photo lands around a few hundred KB as a data URL; this is the
    ceiling a hand-built payload cannot climb past. */
const MAX_BYTES = 3_000_000;

const IMG_LIMIT = limitFromEnv("CAPTURE_IMG_LIMIT", 120);
const IMG_WINDOW = 60_000;

function gate(request: Request) {
  return rateLimit("img:" + clientIp(request), IMG_LIMIT, IMG_WINDOW);
}

function tooMany(retryAfterSec: number) {
  return NextResponse.json(
    { error: `Too many image requests. Try again in ${retryAfterSec}s.` },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
  );
}

/** Ask whether an immutable image id exists without transferring its body. */
export async function HEAD(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const limit = gate(request);
  if (!limit.allowed) return tooMany(limit.retryAfterSec);

  const { id } = await params;
  if (!isSafeImageId(id)) return new Response(null, { status: 400 });

  const exists = await hubStore().exists(keyFor(id));
  return new Response(null, {
    status: exists ? 204 : 404,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const limit = gate(request);
  if (!limit.allowed) return tooMany(limit.retryAfterSec);

  const { id } = await params;
  if (!isSafeImageId(id))
    return NextResponse.json({ error: "bad id" }, { status: 400 });

  const stored = await hubStore().read(keyFor(id));
  if (!stored) {
    /* The hub simply has not been given this one yet — not an error worth
       shouting about; the device that holds it will PUT it on its next push. */
    return NextResponse.json({ error: "not here" }, { status: 404 });
  }
  return NextResponse.json({ src: stored.body });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const limit = gate(request);
  if (!limit.allowed) return tooMany(limit.retryAfterSec);

  const { id } = await params;
  if (!isSafeImageId(id))
    return NextResponse.json({ error: "bad id" }, { status: 400 });

  let src: string;
  try {
    const body = (await request.json()) as { src?: unknown };
    if (typeof body.src !== "string" || !body.src.startsWith("data:"))
      return NextResponse.json({ error: "bad request" }, { status: 400 });
    src = body.src;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (src.length > MAX_BYTES)
    return NextResponse.json({ error: "too large" }, { status: 413 });

  const key = keyFor(id);
  const store = hubStore();

  try {
    /* Create-if-absent closes the race between HEAD and PUT. If another
       device wrote the immutable id first, false means the same image is
       already safe on the hub. */
    const written = await store.write(key, src, { version: null });
    return NextResponse.json({ ok: true, stored: Boolean(written) });
  } catch {
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }
}
