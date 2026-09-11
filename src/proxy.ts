import { NextResponse, type NextRequest } from "next/server";
import { PLAYGROUND, isClosedInPlayground } from "@/lib/playground";
import { AUTH_COOKIE, isValidSession } from "@/lib/auth";
import { isPublicHome } from "@/lib/seo";
import { getCloudConfig } from "@/lib/supabase/config";
import { refreshCloudSession } from "@/lib/supabase/proxy";

/** Paths that must stay reachable without the session cookie. */
const PUBLIC_PATHS = [
  "/login",
  "/about",
  "/install",
  "/funding",
  "/sponsor",
  "/api/login",
  "/manifest.webmanifest",
  "/robots.txt",
  "/sitemap.xml",
  "/sw.js",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-icon.png",
  "/og.png",
  "/og-v2.png",
  "/gleb.jpg",
  "/demos",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

function preserveCloudCookies(response: NextResponse, cloudResponse: NextResponse): NextResponse {
  cloudResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  return response;
}

export async function proxy(request: NextRequest) {
  /* Playground first, before the password gate it runs without: the routes
     that reach past the browser are refused for everyone, so a hand-built
     request gets the same answer the hidden buttons would. */
  if (PLAYGROUND && isClosedInPlayground(request.nextUrl.pathname)) {
    return NextResponse.json({ error: "not available in the playground" }, { status: 404 });
  }
  const { pathname } = request.nextUrl;
  const cloudConfig = getCloudConfig();
  const passThrough = cloudConfig?.status === "ready"
    ? await refreshCloudSession(request, cloudConfig)
    : NextResponse.next();

  // Cloud has its own Supabase identity boundary, never the deployment password.
  if (pathname === "/api/cloud" || pathname.startsWith("/api/cloud/")) {
    return passThrough;
  }
  if (isPublicHome(pathname, PLAYGROUND) || isPublic(pathname)) {
    return passThrough;
  }

  const password = process.env.APP_PASSWORD;
  // No password configured — the gate is off entirely.
  if (!password) return passThrough;

  const cookie = request.cookies.get(AUTH_COOKIE)?.value;
  if (await isValidSession(cookie, password)) return passThrough;

  // API callers get a status code; browsers get the login page.
  if (pathname.startsWith("/api/")) {
    /* Say it. A device whose session has lapsed gets 401 here, before any
       route runs, so nothing downstream can log it — and the platform log
       line for a rejected request looks identical to a served one. That is
       how a phone can sit there reporting "Hub unreachable" while the hub
       looks perfectly healthy from the outside. */
    console.warn(
      "unauthorized api call:",
      pathname,
      cookie ? "(stale or invalid session cookie)" : "(no session cookie)"
    );
    return preserveCloudCookies(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
      passThrough,
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return preserveCloudCookies(NextResponse.redirect(url), passThrough);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
