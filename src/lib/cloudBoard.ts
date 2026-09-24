import { NextResponse } from "next/server";
import { hydrate } from "@/lib/model";
import { mergeSync, type SyncState, type Tombstone } from "@/lib/sync";
import {
  authorizeCloudRequest,
  type CloudQuotaPolicy,
  type CloudQuotaResult,
} from "@/lib/cloudRequestGuard";

type ServerEnv = Record<string, string | undefined>;

export type VerifiedIdentity = { userId: string };
export type CloudBoardDocument = { state: SyncState; rev: number };

export interface CloudBoardRepository {
  get(userId: string): Promise<CloudBoardDocument | null>;
  create(userId: string, state: SyncState): Promise<CloudBoardDocument | null>;
  update(userId: string, expectedRev: number, state: SyncState): Promise<CloudBoardDocument | null>;
}

export interface CloudBoardDependencies {
  isEnabled: () => boolean;
  isConfigured?: () => boolean;
  verifyIdentity: (request: Request) => Promise<VerifiedIdentity | null>;
  requiresEntitlement?: () => boolean;
  hasEntitlement?: (identity: VerifiedIdentity) => Promise<boolean>;
  isAccountErasing?: (identity: VerifiedIdentity) => Promise<boolean>;
  consumeQuota?: (ownerId: string, policy: CloudQuotaPolicy) => Promise<CloudQuotaResult>;
  repository: CloudBoardRepository;
}

const MAX_BODY_BYTES = 2_000_000;
const PUT_ATTEMPTS = 4;

export function isCloudEnabled(env: ServerEnv = process.env): boolean {
  return env.CAPTURE_CLOUD === "1";
}

function json(body: unknown, status = 200): Response {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function validTombstone(value: unknown): value is Tombstone {
  if (!value || typeof value !== "object") return false;
  const tombstone = value as Partial<Tombstone>;
  return (
    typeof tombstone.id === "string" &&
    typeof tombstone.deletedAt === "number" &&
    ["action", "thread", "frag", "intention", "principle"].includes(
      tombstone.kind as string
    )
  );
}

function parseSyncState(raw: string): SyncState | null {
  if (!raw) return null;

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;

  const candidate = body as Partial<SyncState> & { tombstones?: unknown };
  if (!candidate.board || typeof candidate.board !== "object" || Array.isArray(candidate.board)) {
    return null;
  }
  const tombstones = candidate.tombstones;
  if (tombstones !== undefined) {
    if (!Array.isArray(tombstones) || !tombstones.every(validTombstone)) return null;
  }

  return {
    board: hydrate(candidate.board),
    tombstones: tombstones ?? [],
  };
}

type BodyRead =
  | { status: "ok"; text: string }
  | { status: "too-large" }
  | { status: "bad-request" };

async function readBoundedBody(request: Request): Promise<BodyRead> {
  const declared = request.headers.get("content-length");
  if (declared) {
    const bytes = Number(declared);
    if (Number.isFinite(bytes) && bytes > MAX_BODY_BYTES) {
      return { status: "too-large" };
    }
  }

  if (!request.body) return { status: "ok", text: "" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return { status: "too-large" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { status: "ok", text };
  } catch {
    return { status: "bad-request" };
  } finally {
    reader.releaseLock();
  }
}

function emptyState(): SyncState {
  return { board: hydrate(null), tombstones: [] };
}

function responseDocument(document: CloudBoardDocument): SyncState & { rev: number } {
  return { ...document.state, rev: document.rev };
}

function guardDependencies(deps: CloudBoardDependencies) {
  return {
    isCloudHost: deps.isEnabled,
    isConfigured: deps.isConfigured ?? (() => true),
    requiresEntitlement: deps.requiresEntitlement ?? (() => false),
    verifyIdentity: deps.verifyIdentity,
    hasEntitlement: deps.hasEntitlement ?? (async () => {
      throw new Error("Cloud entitlement unavailable");
    }),
    isAccountErasing: deps.isAccountErasing ?? (async () => {
      throw new Error("Cloud account lifecycle unavailable");
    }),
    consumeQuota: deps.consumeQuota ?? (async () => {
      throw new Error("Cloud quota unavailable");
    }),
  };
}

export async function handleCloudBoardGet(
  request: Request,
  deps: CloudBoardDependencies
): Promise<Response> {
  if (!deps.isEnabled()) return json({ error: "not found" }, 404);
  if (deps.isConfigured && !deps.isConfigured()) return json({ error: "cloud is not configured" }, 503);

  const scope = new URL(request.url).searchParams.get("backup") === "1"
    ? "backup_read" as const
    : "board_read" as const;
  const authorization = await authorizeCloudRequest(request, scope, guardDependencies(deps));
  if (authorization instanceof Response) return authorization;
  if (authorization.mode !== "cloud") return json({ error: "not found" }, 404);
  const identity: VerifiedIdentity = { userId: authorization.ownerId };

  try {
    const document = await deps.repository.get(identity.userId);
    return json(document ? responseDocument(document) : { ...emptyState(), rev: 0 });
  } catch {
    return json({ error: "cloud unavailable" }, 503);
  }
}

export async function handleCloudBoardPut(
  request: Request,
  deps: CloudBoardDependencies
): Promise<Response> {
  if (!deps.isEnabled()) return json({ error: "not found" }, 404);
  if (deps.isConfigured && !deps.isConfigured()) return json({ error: "cloud is not configured" }, 503);

  const authorization = await authorizeCloudRequest(request, "board_write", guardDependencies(deps));
  if (authorization instanceof Response) return authorization;
  if (authorization.mode !== "cloud") return json({ error: "not found" }, 404);
  const identity: VerifiedIdentity = { userId: authorization.ownerId };

  const body = await readBoundedBody(request);
  if (body.status === "too-large") {
    return json({ error: "payload too large" }, 413);
  }
  if (body.status === "bad-request") {
    return json({ error: "bad request" }, 400);
  }
  const clientState = parseSyncState(body.text);
  if (!clientState) {
    return json({ error: "bad request" }, 400);
  }

  try {
    for (let attempt = 0; attempt < PUT_ATTEMPTS; attempt++) {
      const current = await deps.repository.get(identity.userId);
      const merged = mergeSync(current?.state ?? emptyState(), clientState);
      // Acknowledge only inside the same optimistic write as the history.
      // Failed writes/retries keep the client pending; receipts survive resets
      // so a delayed pre-import document cannot replay an already accepted copy.
      if (merged.board.historyImports) {
        merged.board = { ...merged.board, historyImports: Object.fromEntries(
          Object.keys(merged.board.historyImports).map(id => [id, "accepted" as const])
        ) };
      }
      const accepted = current
        ? await deps.repository.update(identity.userId, current.rev, merged)
        : await deps.repository.create(identity.userId, merged);

      if (accepted) return json(responseDocument(accepted));
    }
  } catch {
    return json({ error: "cloud unavailable" }, 503);
  }

  return json({ error: "cloud board is busy; retry shortly" }, 503);
}
