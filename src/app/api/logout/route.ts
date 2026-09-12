import { NextResponse } from "next/server";
import { AUTH_COOKIE } from "@/lib/auth";
import { getCloudConfig } from "@/lib/supabase/config";
import { createCloudServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** End both supported session types on this device. */
export async function POST() {
  const cloud = getCloudConfig();
  let cloudError = false;
  if (cloud?.status === "ready") {
    try {
      const client = await createCloudServerClient(cloud);
      const { error } = await client.auth.signOut({ scope: "local" });
      cloudError = !!error;
    } catch {
      cloudError = true;
    }
  }

  const response = NextResponse.json(
    cloudError ? { error: "logout could not be completed" } : { ok: true },
    { status: cloudError ? 502 : 200 },
  );
  response.cookies.set({
    name: AUTH_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
