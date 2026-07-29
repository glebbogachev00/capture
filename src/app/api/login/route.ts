import { NextResponse } from "next/server";
import { AUTH_COOKIE, checkPassword, createSessionValue } from "@/lib/auth";

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

  if (!body.password || !checkPassword(body.password, password)) {
    // A uniform delay makes guessing marginally less pleasant.
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
