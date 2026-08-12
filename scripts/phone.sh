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

# `tailscale serve` is tailnet-only by default, so only your own devices can
# reach the app — a password is optional but recommended if you ever make the
# serve public (tailscale serve --https=443). Warn instead of blocking.
if ! grep -q '^APP_PASSWORD=' .env.local 2>/dev/null; then
  echo "⚠  No APP_PASSWORD in .env.local — add APP_PASSWORD=something-secret to" >&2
  echo "   .env.local for a login gate. Continuing anyway: this serve is" >&2
  echo "   tailnet-only, so only devices on your Tailnet can reach it." >&2
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

# Start the local transcriber (~/whisper, Parakeet) unless one is already
# answering. Dictation falls back to Groq without it, so a missing checkout
# or a failed start degrades rather than blocks.
TRANSCRIBER_PID=""
WHISPER_DIR="${WHISPER_DIR:-$HOME/whisper}"
if curl -sf http://127.0.0.1:8756/health >/dev/null 2>&1; then
  echo "→ Local transcriber already running."
elif [ -f "$WHISPER_DIR/server.py" ] && command -v uv >/dev/null 2>&1; then
  echo "→ Starting local transcriber (log: /tmp/capture-transcriber.log)…"
  (cd "$WHISPER_DIR" && exec uv run python server.py) \
    > /tmp/capture-transcriber.log 2>&1 &
  TRANSCRIBER_PID=$!
else
  echo "⚠  No local transcriber found at $WHISPER_DIR — dictation will use" >&2
  echo "   Groq (needs GROQ_API_KEY in .env.local)." >&2
fi
trap '[ -n "$TRANSCRIBER_PID" ] && kill "$TRANSCRIBER_PID" 2>/dev/null || true' EXIT

echo
echo "→ Open ${HOSTNAME:-the https://…ts.net URL from 'tailscale serve status'} on your phone"
echo "  (Safari on iPhone — not the installed home-screen app; Chrome on Android is fine)."
echo "  Allow the mic the first time. Ctrl-C here stops the server."
echo
# `npm start -- -H …` so the flags reach `next start`; npm would otherwise
# swallow them and exit with a usage error (that's how the first run died).
# Not `exec` anymore: the EXIT trap above must survive to stop the
# transcriber when this script ends.
caffeinate -i -s npm start -- -H 0.0.0.0 -p 3000
