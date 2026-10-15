import { SUBSCRIPTIONS, defaultModel, isSubscription, providerOfKey } from "@/lib/aiProviders";
import { loadAiSettings, modelsFor } from "@/lib/aiSettings.server";
import { authorizeAiSettingsRequest } from "@/lib/cloudRequestGuard.server";

/** The models a key can use: a new key's, or a stored row's by its id. */
export async function POST(request: Request) {
  const who = await authorizeAiSettingsRequest(request);
  if (who instanceof Response) return who;
  const headers = { "Cache-Control": "private, no-store" };
  let body: { key?: unknown; id?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "bad request" }, { status: 400, headers }); }
  let key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key && typeof body.id === "string") {
    const stored = (await loadAiSettings(who.ownerId).catch(() => ({ connections: [] }))).connections.find((row) => row.id === body.id);
    /* A subscription's models are the ones its app offers. */
    if (stored && isSubscription(stored.provider)) {
      const { models, defaultModel: usual } = SUBSCRIPTIONS[stored.provider];
      return Response.json({ provider: stored.provider, models, defaultModel: usual }, { headers });
    }
    key = stored?.key ?? "";
  }
  const provider = providerOfKey(key);
  if (!provider) return Response.json({ error: "unrecognised key" }, { status: 400, headers });
  try {
    const models = await modelsFor(provider, key, AbortSignal.timeout(10_000));
    return Response.json({ provider, models, defaultModel: defaultModel(provider, models) }, { headers });
  } catch (error) {
    const status = (error as { status?: number }).status;
    const refused = status === 401 || status === 403;
    return Response.json({ error: refused ? "refused" : "unreachable", provider }, { status: refused ? 400 : 502, headers });
  }
}
