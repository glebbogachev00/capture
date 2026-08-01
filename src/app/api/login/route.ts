import { NextResponse } from "next/server";
import { AUTH_COOKIE, checkPassword, createSessionValue } from "@/lib/auth";
import { clientIp } from "@/lib/clientIp";
import { rateLimit } from "@/lib/limiter";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    return NextResponse.json({ error: "auth not configured" }, { status: 400 });
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Refuse attempts once a client has tried too often in the window, and let
  // the client know when it may try again.
  const gate = rateLimit(clientIp(request));
  if (!gate.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${gate.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } }
    );
  }

  if (!body.password || !(await checkPassword(body.password, password))) {
    // A uniform delay makes guessing marginally less pleasant. The failed
    // attempt above nudges the client toward the 429 lockout.
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: AUTH_COOKIE,
    value: await createSessionValue(password),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return response;
}
