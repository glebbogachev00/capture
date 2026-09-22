import { isCloudEnabled } from "@/lib/cloudBoard";
import { getCloudConfig } from "@/lib/supabase/config";
import { createCloudServerClient } from "@/lib/supabase/server";
import { opsEvent } from "@/lib/opsEvent.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const reply = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/** Entry contract is independent of subscription entitlement. Only an explicit
 * missing session grants the local anonymous namespace; verification failures
 * never grant a different board. No tokens/cookies are exposed to the client.
 */
export async function GET() {
  if (!isCloudEnabled()) return reply({ error: "not found" }, 404);
  const config = getCloudConfig();
  if (config?.status !== "ready") {
    opsEvent({ event: "cloud_identity", outcome: "failure", reason: "not_configured" });
    return reply({ error: "cloud is not configured" }, 503);
  }
  try {
    const client = await createCloudServerClient(config);
    const { data, error } = await client.auth.getClaims();
    if (error?.name === "AuthSessionMissingError" || (!error && !data)) {
      return reply({ owner: null, expiresAt: Date.now() + 3_600_000 });
    }
    if (error) throw error;
    const claims = data?.claims;
    if (!claims || typeof claims.sub !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(claims.sub) ||
        typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) {
      throw new Error("invalid verified claims");
    }
    return reply({ owner: claims.sub, expiresAt: Math.min(claims.exp * 1000, Date.now() + 3_600_000) });
  } catch {
    opsEvent({ event: "cloud_identity", outcome: "failure", reason: "dependency_unavailable" });
    return reply({ error: "account verification unavailable" }, 503);
  }
}
