#!/usr/bin/env bash
# One command to make capture reachable from your phone:
#   build → start on 0.0.0.0 under caffeinate (Mac stays awake) → tailscale serve
#
# Prereqs (one-time):
#   - Tailscale installed on the Mac and signed in
#     (https://tailscale.com/download)
#   - MagicDNS + HTTPS Certificates enabled in the admin console
#     (login.tailscale.com → DNS)
#
# Usage: npm run phone
# Then open the printed https://…ts.net URL on your phone (Safari on iPhone).

set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Building the app…"
npm run build

if ! command -v tailscale >/dev/null 2>&1; then
  echo "tailscale isn't installed. Get it from https://tailscale.com/download" >&2
  exit 1
fi

if ! grep -q '^APP_PASSWORD=' .env.local 2>/dev/null; then
  echo "⚠  No APP_PASSWORD in .env.local — anyone who reaches your URL can use" >&2
  echo "   your model quota. Add APP_PASSWORD=something-secret, then re-run." >&2
  exit 1
fi

echo "→ Exposing port 3000 over HTTPS (tailscale serve)…"
if ! tailscale serve --bg 3000; then
  echo "tailscale serve failed. Make sure you're logged in and MagicDNS +" >&2
  echo "HTTPS Certificates are enabled in the admin console" >&2
  echo "(login.tailscale.com → DNS)." >&2
  exit 1
fi
HOSTNAME="$(tailscale serve status 2>/dev/null | grep -oE 'https://[^ ]+' | head -1 || true)"
if [ -z "${HOSTNAME:-}" ]; then
  # Fall back to the machine's MagicDNS name; strip the trailing dot.
  HOSTNAME="https://$(tailscale status --json 2>/dev/null | grep -oE '"DNSName":"[^"]+' | head -1 | cut -d'"' -f4 | sed 's/\.$//' || true)"
fi
if [ -z "${HOSTNAME:-}" ]; then
  echo "Couldn't read the Tailscale URL — run 'tailscale serve status' to find it." >&2
fi

echo
echo "→ Open ${HOSTNAME:-the https://…ts.net URL from 'tailscale serve status'} on your phone"
echo "  (Safari on iPhone — not the installed home-screen app; Chrome on Android is fine)."
echo "  Allow the mic the first time. Ctrl-C here stops the server."
echo
exec caffeinate -i -s npm start -H 0.0.0.0 -p 3000
