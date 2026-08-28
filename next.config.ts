import { execSync } from "node:child_process";
import type { NextConfig } from "next";

/* A name for this exact build, so a running app can tell whether the server
   has moved on without it.
 *
 * The board is a single-page app that people keep open — installed to a home
 * screen, resumed days later, never actually navigated. Its JavaScript is
 * whatever was loaded the first time. A phone spent an evening reporting a
 * bug that had been fixed that morning, against a build from the day before,
 * and every "it is still broken" after a real fix cost an hour of looking in
 * the wrong place. An app that cannot tell you it is out of date makes every
 * bug report unreliable.
 *
 * Whatever this resolves to must be IDENTICAL for the client bundle and the
 * server route within one build, or the two disagree forever and the app
 * reloads in a loop. The deployment's own identity is used where there is
 * one; the commit is stable locally; the timestamp is a last resort and is
 * why the client also refuses to reload twice for the same answer. */
const BUILD_ID =
  process.env.VERCEL_DEPLOYMENT_ID ||
  process.env.VERCEL_URL ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  (() => {
    try {
      return execSync("git rev-parse --short HEAD", {
        cwd: __dirname,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      return "dev";
    }
  })();

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  /* Pin the workspace root to this project. Next otherwise walks up looking
     for a lockfile, finds one in a parent directory, and traces the whole of
     that tree into the build — which both warns and risks pulling unrelated
     files from the home directory into the output. */
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
  /* Keep the board out of the deployment package.
   *
   * hubStore builds its paths at runtime from SYNC_DATA_DIR, which the
   * tracer cannot follow, so it falls back to assuming the route might read
   * anything under the project root — and on a development machine that
   * root contains the real hub. The traced manifests for /api/sync and
   * /api/img each listed thirteen private files: the live sync.json, an
   * older snapshot of it, and the exported ledger, corrections, actions,
   * intentions and principles. Nothing had shipped, but a packager that
   * honours those manifests would have bundled them.
   *
   * These directories hold data, never code, so nothing can legitimately
   * need them at runtime. */
  outputFileTracingExcludes: {
    "**": [
      ".data/**",
      "CaptureVault/**",
      "outputs/**",
      ".next-*/**",
      "docs/**",
      "scripts/**",
      "**/*.png",
      "**/*.jpg",
      "**/*.mp4",
    ],
  },
  /* A second dev server (Retake records demos against an isolated copy on
     :3100) needs its own build dir, or Next refuses to start it. */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  /* The demo copy must not record Next's dev-tools badge into the videos.
     The normal dev server on :3000 keeps its indicators. */
  ...(process.env.NEXT_DIST_DIR ? { devIndicators: false as const } : {}),
  /* Dev is reached from the phone through tailscale serve, which makes every
     request cross-origin from Next's point of view; without this it silently
     refuses to serve the JS bundles, so pages render but never hydrate. */
  allowedDevOrigins: [
    "andreys-macbook-air.tail204d23.ts.net", // tailscale serve (https)
    "100.117.116.1", // tailnet IP, direct
    "192.168.0.104", // home LAN, no tailscale needed
    "172.20.10.14", // iPhone hotspot — phone talks to the Mac directly
  ],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            /*
             * Moderate CSP. The two 'unsafe-inline/eval' entries are what
             * Next's own bootstrap and the app's inline style attributes need;
             * everything else is locked to self, and images arrive as data:
             * URLs straight from IndexedDB.
             */
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "worker-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          /*
           * Microphone is left alone — dictation is the primary input. The
           * file input for photos is not getUserMedia, so camera can stay
           * closed; everything else on this list is unused.
           */
          {
            key: "Permissions-Policy",
            value:
              "camera=(), geolocation=(), payment=(), usb=(), serial=(), xr=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
