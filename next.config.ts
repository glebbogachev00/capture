import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
