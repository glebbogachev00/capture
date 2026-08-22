import { NextResponse } from "next/server";
import { clientIp } from "@/lib/clientIp";
import { limitFromEnv, rateLimit } from "@/lib/limiter";
import { hydrate } from "@/lib/model";
import { getSync, pushSync } from "@/lib/syncStore";
import { usingBlob } from "@/lib/hubStore";
import { type SyncState, type Tombstone } from "@/lib/sync";

/** Why the hub could not store the board, in terms of the thing to fix.
    Serverless hosts have no writable disk, so a deployment without a blob
    store has nowhere to put anything — and that is a setup step, not a
    transient hiccup. */
function hubUnavailable(): string {
  return usingBlob()
    ? "The sync hub could not be written to. Your capture is safe on this device; it will push again shortly."
    : "This deployment has nowhere to store the board. Create a Vercel Blob store and set BLOB_READ_WRITE_TOKEN, or run the app somewhere with a writable disk.";
}

/**
 * The sync route.
 *
 * The auth proxy already gates /api/* behind the login cookie, so a caller
 * reaching this route is the one person who knows the password. The route
 * itself just moves the board between that person's devices: GET is a pull,
 * POST is a push that the hub MERGES (never replaces) and returns, so both
 * sides converge.
 *
 * Rate-limited like the other endpoints: a hijacked session shouldn't be able
 * to churn the hub, even though a merge is far cheaper than a model call.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYNC_LIMIT = limitFromEnv("CAPTURE_SYNC_LIMIT", 60);
const SYNC_WINDOW = 60_000;

/** Keep a client pushing junk or a giant board from filling the disk. */
const MAX_BODY = 2_000_000;

function gate(request: Request) {
  return rateLimit("sync:" + clientIp(request), SYNC_LIMIT, SYNC_WINDOW);
}

export async function GET(request: Request) {
  const gateResult = gate(request);
  if (!gateResult.allowed) {
    return NextResponse.json(
      { error: `Too many syncs. Try again in ${gateResult.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(gateResult.retryAfterSec) } }
    );
  }
  let stored;
  try {
    stored = await getSync();
  } catch (error) {
    /* The store could not be read. Say it in the log in words — the stack
       Next prints for an unhandled throw is how a suspended blob store went
       unnamed for an evening — and give the device the same honest answer a
       failed push gets. */
    console.error(
      "sync read failed:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: hubUnavailable() }, { status: 503 });
  }
  /* A poll that already knows this revision gets a two-field answer instead
     of the whole board — the client polls every 10s, and almost every poll
     finds nothing new. Any mismatch (including a reset hub) falls through
     to the full payload. */
  const known = new URL(request.url).searchParams.get("rev");
  if (known !== null && Number(known) === stored.rev) {
    return NextResponse.json({ unchanged: true, rev: stored.rev });
  }
  return NextResponse.json(stored);
}

export async function POST(request: Request) {
  const gateResult = gate(request);
  if (!gateResult.allowed) {
    return NextResponse.json(
      { error: `Too many syncs. Try again in ${gateResult.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(gateResult.retryAfterSec) } }
    );
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!raw || raw.length > MAX_BODY) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const candidate = body as Partial<SyncState>;
  if (
    !candidate ||
    typeof candidate.board !== "object" ||
    candidate.board === null
  ) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const tombstones: Tombstone[] = Array.isArray(candidate.tombstones)
    ? candidate.tombstones.filter(
        (t): t is Tombstone =>
          !!t &&
          typeof t === "object" &&
          typeof t.id === "string" &&
          typeof t.deletedAt === "number" &&
          ["action", "thread", "frag", "intention", "principle"].includes(
            (t as Tombstone).kind
          )
      )
    : [];

  try {
    const stored = await pushSync({
      board: hydrate(candidate.board),
      tombstones,
    });
    return NextResponse.json(stored);
  } catch (error) {
    /* Say it out loud. This catch was silent, and a push that failed every
       single time for a day left no trace in the logs — the board looked
       reachable, the blob simply stopped changing. A hub that cannot store
       is the most important thing this route can report. */
    console.error(
      "sync push failed:",
      error instanceof Error ? error.message : error
    );
    /* A hub that cannot store must say so in words the person can act on.
       The old code let the write fail and kept a copy in memory, so a
       deployment with nowhere to write still looked healthy right up until
       the instance recycled and took the board with it. */
    return NextResponse.json({ error: hubUnavailable() }, { status: 503 });
  }
}
