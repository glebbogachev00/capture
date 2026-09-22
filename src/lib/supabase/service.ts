import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { CloudConfig } from "./config";

type Env = Record<string, string | undefined>;

export function createCloudServiceClient(config: CloudConfig, env: Env = process.env) {
  const secret = env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!secret.startsWith("sb_secret_")) return null;
  return createClient(config.url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
