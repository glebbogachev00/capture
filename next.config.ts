import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
