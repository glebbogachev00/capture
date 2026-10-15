import { isKeyProvider, isSubscription, providerOfKey, validModel } from "@/lib/aiProviders";
import { loadAiSettings, saveAiSettings, viewOf, type StoredConnection } from "@/lib/aiSettings.server";
import { authorizeAiSettingsRequest } from "@/lib/cloudRequestGuard.server";
import { subscriptionStatus } from "@/lib/subscriptions.server";

/**
 * The AI a person connected: read as a list without keys, and replaced as a
 * whole list in priority order. A row brings its key only when it is new;
 * otherwise it names a row that is already stored.
 */

const mode = () => (process.env.CAPTURE_CLOUD === "1" ? "cloud" : "local");
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const who = await authorizeAiSettingsRequest(request);
  if (who instanceof Response) return who;
  try {
    const view = viewOf(await loadAiSettings(who.ownerId));
    /* Subscriptions are the Mac's own apps: a self-hosted Capture only. */
    const subscriptions = who.ownerId === null ? await subscriptionStatus() : undefined;
    return Response.json({ mode: mode(), ...view, ...(subscriptions ? { subscriptions } : {}) }, { headers });
  } catch {
    return Response.json({ error: "ai settings unavailable" }, { status: 503, headers });
  }
}

export async function PUT(request: Request) {
  const who = await authorizeAiSettingsRequest(request);
  if (who instanceof Response) return who;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "bad request" }, { status: 400, headers }); }
  const rows = (body as { connections?: unknown })?.connections;
  if (!Array.isArray(rows) || rows.length > 8) return Response.json({ error: "bad request" }, { status: 400, headers });
  try {
    const stored = new Map((await loadAiSettings(who.ownerId)).connections.map((row) => [row.id, row]));
    const next: StoredConnection[] = [];
    for (const row of rows) {
      const { id, model, key, provider } = (row ?? {}) as Record<string, unknown>;
      if (typeof id !== "string" || !/^[\w-]{1,40}$/.test(id) || !validModel(model)) {
        return Response.json({ error: "bad request" }, { status: 400, headers });
      }
      if (typeof key === "string" && key.trim()) {
        const provider = providerOfKey(key);
        if (!provider) return Response.json({ error: "unrecognised key" }, { status: 400, headers });
        next.push({ id, provider, model, key: key.trim(), hint: key.trim().slice(-4) });
        continue;
      }
      const existing = stored.get(id);
      if (!existing && isSubscription(provider) && who.ownerId === null) {
        next.push({ id, provider, model, key: "", hint: "" });
        continue;
      }
      if (!existing || !(isKeyProvider(existing.provider) || isSubscription(existing.provider))) {
        return Response.json({ error: "unknown connection" }, { status: 400, headers });
      }
      next.push({ ...existing, model });
    }
    await saveAiSettings(who.ownerId, { connections: next });
    return Response.json({ mode: mode(), ...viewOf({ connections: next }) }, { headers });
  } catch {
    return Response.json({ error: "ai settings could not be saved" }, { status: 503, headers });
  }
}
