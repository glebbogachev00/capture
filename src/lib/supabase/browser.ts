"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { CloudConfig } from "./config";

export function createCloudBrowserClient(config: CloudConfig) {
  return createBrowserClient(config.url, config.publishableKey);
}
