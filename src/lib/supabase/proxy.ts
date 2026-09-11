import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { CloudConfig } from "./config";

type CookieValue = {
  name: string;
  value: string;
  options: CookieOptions;
};

type ProxyClient = {
  auth: {
    getClaims(): Promise<unknown>;
  };
};

export type ProxyClientFactory = (
  url: string,
  publishableKey: string,
  options: {
    cookies: {
      getAll(): { name: string; value: string }[];
      setAll(values: CookieValue[]): void;
    };
  },
) => ProxyClient;

const createClient: ProxyClientFactory = (url, publishableKey, options) =>
  createServerClient(url, publishableKey, options) as unknown as ProxyClient;

/**
 * Refresh the Supabase session at the request boundary.
 *
 * Supabase may rotate the access and refresh tokens while validating claims.
 * Both copies matter: the mutated request is visible to this render, while the
 * response cookies keep the browser signed in for the next request.
 */
export async function refreshCloudSession(
  request: NextRequest,
  config: CloudConfig,
  factory: ProxyClientFactory = createClient,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const client = factory(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  await client.auth.getClaims();
  return response;
}
