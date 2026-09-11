export type CloudConfig = {
  status: "ready";
  url: string;
  publishableKey: string;
};

export type CloudConfigResult = CloudConfig | { status: "missing" } | null;

type Env = Record<string, string | undefined>;

function legacyJwtRole(key: string): string | null {
  const payload = key.split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as { role?: unknown };
    return typeof parsed.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
}

function isPublishableKey(key: string): boolean {
  if (key.startsWith("sb_publishable_")) return true;
  if (key.startsWith("sb_secret_")) return false;
  return legacyJwtRole(key) === "anon";
}

export function getCloudConfig(env: Env = process.env): CloudConfigResult {
  if (env.CAPTURE_CLOUD !== "1") return null;
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  try {
    const parsed = new URL(url);
    if (!(parsed.protocol === "https:" || parsed.protocol === "http:") || !parsed.hostname) return { status: "missing" };
  } catch {
    return { status: "missing" };
  }
  if (!isPublishableKey(publishableKey)) return { status: "missing" };
  return { status: "ready", url, publishableKey };
}

export function isCloudConfigured(env: Env = process.env): boolean {
  return getCloudConfig(env)?.status === "ready";
}
