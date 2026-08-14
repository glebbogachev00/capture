import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { clientIp } from "@/lib/clientIp";
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
 * Same storage rules as the sync hub next door: $SYNC_DATA_DIR (or `.data/`),
 * a real disk on the machine that hosts it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIR = path.join(
  process.env.SYNC_DATA_DIR || path.join(process.cwd(), ".data"),
  "img"
);

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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const limit = gate(request);
  if (!limit.allowed) return tooMany(limit.retryAfterSec);

  const { id } = await params;
  if (!isSafeImageId(id))
    return NextResponse.json({ error: "bad id" }, { status: 400 });

  try {
    const src = await fs.readFile(path.join(DIR, id), "utf8");
    return NextResponse.json({ src });
  } catch {
    /* The hub simply has not been given this one yet — not an error worth
       shouting about; the device that holds it will PUT it on its next push. */
    return NextResponse.json({ error: "not here" }, { status: 404 });
  }
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

  const file = path.join(DIR, id);
  try {
    /* Already here: the bytes behind an id never change, so this is done. */
    await fs.access(file);
    return NextResponse.json({ ok: true, stored: false });
  } catch {
    /* Not here yet — write it. */
  }

  try {
    await fs.mkdir(DIR, { recursive: true });
    /* Temp file then rename, like the sync hub: a crash mid-write can never
       leave half a photo under a real id. */
    const tmp = file + ".tmp";
    await fs.writeFile(tmp, src, "utf8");
    await fs.rename(tmp, file);
    return NextResponse.json({ ok: true, stored: true });
  } catch {
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }
}
