import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { CloudConfig } from "./config";

export async function createCloudServerClient(config: CloudConfig) {
  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Route handlers may be read-only in some Next.js render contexts.
        }
      },
    },
  });
}
