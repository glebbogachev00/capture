import "server-only";

import { authorizeCloudRequest } from "@/lib/cloudRequestGuard";
import { createCloudGuardServerContext } from "@/lib/cloudRequestGuard.server";
import { identityFromClaims } from "@/lib/supabase/identity";
import { ownerPrecondition } from "@/lib/ownerPrecondition";
import {
  PUBLISH_ORIGIN,
  PublicThreadInputSchema,
  isPublicThreadToken,
  publicThreadPath,
  publicThreadToken,
} from "@/lib/publicThread";
import {
  TokenTakenError,
  filePublicThreadStore,
  publicThreadMode,
  supabasePublicThreadStore,
  type PublicThreadStore,
} from "@/lib/publicThreadStore.server";

/** Owner-only API for public snapshots. Reading a snapshot is NOT here: it is
 * the anonymous page and text route, which only ever call store.read(token). */

export type Owner = { owner: string; store: PublicThreadStore };
export type PublicThreadsDeps = {
  /** Verified identity + owner header + account fences + the publish quota,
      or a refusal. A free account is enough: no subscription check. */
  authorize(request: Request): Promise<Owner | Response>;
  /** Who is signed in, for the confirmation page; null when nobody. */
  whoami(request: Request): Promise<string | null>;
  newToken(title: string): string;
  origin: string;
};

const MAX_BODY = 500_000;
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function getPublicThreads(request: Request, deps: PublicThreadsDeps): Promise<Response> {
  if (new URL(request.url).searchParams.has("whoami")) {
    return reply({ owner: await deps.whoami(request) });
  }
  const auth = await deps.authorize(request);
  if (auth instanceof Response) return auth;
  const threads = await auth.store.list(auth.owner);
  return reply({
    owner: auth.owner,
    threads: threads.map((thread) => ({ ...thread, url: deps.origin + publicThreadPath(thread.token) })),
  });
}

export async function postPublicThread(request: Request, deps: PublicThreadsDeps): Promise<Response> {
  const auth = await deps.authorize(request);
  if (auth instanceof Response) return auth;
  const raw = await request.text().catch(() => "");
  if (!raw || raw.length > MAX_BODY) return reply({ error: "snapshot too large" }, 413);
  let body: { snapshot?: unknown; replace?: unknown };
  try { body = JSON.parse(raw); } catch { return reply({ error: "bad request" }, 400); }
  const parsed = PublicThreadInputSchema.safeParse(body.snapshot);
  if (!parsed.success) return reply({ error: "snapshot is not valid" }, 400);
  const input = parsed.data;

  if (body.replace !== undefined) {
    if (!isPublicThreadToken(body.replace)) return reply({ error: "bad request" }, 400);
    const updated = await auth.store.update(auth.owner, body.replace, input);
    if (!updated) return reply({ error: "not found" }, 404);
    return reply({ thread: updated, url: deps.origin + publicThreadPath(updated.token) });
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const created = await auth.store.create(auth.owner, deps.newToken(input.title), input);
      return reply({ thread: created, url: deps.origin + publicThreadPath(created.token) }, 201);
    } catch (error) {
      if (!(error instanceof TokenTakenError)) throw error;
    }
  }
  return reply({ error: "publish failed" }, 503);
}

export async function deletePublicThread(request: Request, deps: PublicThreadsDeps): Promise<Response> {
  const auth = await deps.authorize(request);
  if (auth instanceof Response) return auth;
  const token = new URL(request.url).searchParams.get("token");
  if (!isPublicThreadToken(token)) return reply({ error: "bad request" }, 400);
  return (await auth.store.remove(auth.owner, token)) ? reply({ ok: true }) : reply({ error: "not found" }, 404);
}

/* Wiring. */

export const PREVIEW_OWNER_COOKIE = "capture-preview-owner";

function previewOwner(request: Request): string {
  const cookie = request.headers.get("cookie") ?? "";
  const value = cookie.split(/;\s*/).find((part) => part.startsWith(`${PREVIEW_OWNER_COOKIE}=`))?.split("=")[1];
  return value && /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : "preview-owner";
}

export function publicThreadsDeps(): PublicThreadsDeps | null {
  const mode = publicThreadMode();
  const base = { newToken: (title: string) => publicThreadToken(title), origin: PUBLISH_ORIGIN };
  if (mode === "cloud") {
    return {
      ...base,
      async authorize(request) {
        const { client, guard } = await createCloudGuardServerContext();
        const result = await authorizeCloudRequest(request, "publish", guard);
        if (result instanceof Response) return result;
        if (result.mode !== "cloud") return reply({ error: "not found" }, 404);
        return { owner: result.ownerId, store: supabasePublicThreadStore(client) };
      },
      async whoami() {
        const { client } = await createCloudGuardServerContext();
        if (!client) return null;
        return (await identityFromClaims(client).catch(() => null))?.userId ?? null;
      },
    };
  }
  if (mode === "preview") {
    const store = filePublicThreadStore(process.env.CAPTURE_PUBLISH_PREVIEW_DIR!.trim());
    return {
      ...base,
      async authorize(request) {
        const owner = previewOwner(request);
        return ownerPrecondition(request, owner) ?? { owner, store };
      },
      async whoami(request) { return previewOwner(request); },
    };
  }
  return null;
}

/** The anonymous read side: same store, read only. */
export function publicThreadReader(): PublicThreadStore | null {
  const mode = publicThreadMode();
  if (mode === "cloud") return supabasePublicThreadStore(null);
  if (mode === "preview") return filePublicThreadStore(process.env.CAPTURE_PUBLISH_PREVIEW_DIR!.trim());
  return null;
}
