import { NextResponse } from "next/server";
import { clientIp } from "@/lib/clientIp";
import { limitFromEnv, rateLimit } from "@/lib/limiter";
import { hydrate } from "@/lib/model";
import { getSync, pushSync } from "@/lib/syncStore";
import { type SyncState, type Tombstone } from "@/lib/sync";

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
  const stored = await getSync();
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

  const stored = await pushSync({ board: hydrate(candidate.board), tombstones });
  return NextResponse.json(stored);
}
