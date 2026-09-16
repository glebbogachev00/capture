import { isCloudEnabled } from "@/lib/cloudBoard";
import { getCloudConfig } from "@/lib/supabase/config";
import { createCloudServerClient } from "@/lib/supabase/server";

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
    console.warn("[cloud-identity]", { stage: "configuration", code: "unavailable", status: 503 });
    return reply({ error: "cloud is not configured" }, 503);
  }
  // Request-local enums only: never derive diagnostics from provider payloads.
  // At most one fixed-size log per failed request; successful checks stay silent.
  let stage: "client_creation" | "get_claims" | "claims_validation" = "client_creation";
  let code: "exception" | "provider_error" | "invalid_claims" = "exception";
  try {
    const client = await createCloudServerClient(config);
    stage = "get_claims";
    const { data, error } = await client.auth.getClaims();
    if (error?.name === "AuthSessionMissingError" || (!error && !data)) {
      return reply({ owner: null, expiresAt: Date.now() + 3_600_000 });
    }
    if (error) { code = "provider_error"; throw error; }
    stage = "claims_validation";
    const claims = data?.claims;
    if (!claims || typeof claims.sub !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(claims.sub) ||
        typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) {
      code = "invalid_claims";
      throw new Error("invalid verified claims");
    }
    return reply({ owner: claims.sub, expiresAt: Math.min(claims.exp * 1000, Date.now() + 3_600_000) });
  } catch {
    console.warn("[cloud-identity]", { stage, code, status: 503 });
    return reply({ error: "account verification unavailable" }, 503);
  }
}
