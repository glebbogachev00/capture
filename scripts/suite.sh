#!/usr/bin/env bash
#
# Run the mobile suite against a deployment — Vercel first, local second.
#
# Every test and recording before today ran against localhost, where no
# function timeout exists. Two features were being killed at Vercel's
# sixty-second ceiling and passing every local test, which is how a broken
# app reached a phone with a green suite behind it. Where the tests run is
# not a detail; it is the difference between testing the product and
# testing a copy of it that has no limits.
#
#   scripts/suite.sh https://capture-xyz.vercel.app     # a preview
#   scripts/suite.sh http://localhost:4996              # the local build
#
# The preview needs APP_PASSWORD blank for the Preview environment, or the
# suite gets a 401 and cannot drive anything.
set -euo pipefail

URL="${1:-}"
if [ -z "$URL" ]; then
  echo "usage: scripts/suite.sh <base-url>" >&2
  exit 1
fi
URL="${URL%/}"

RETAKE="${RETAKE_DIR:-$HOME/Documents/Retake}"
SRC="$RETAKE/demos/capture-mobile-suite.yaml"
OUT="$RETAKE/demos/capture-mobile-suite.run.yaml"

if [ ! -f "$SRC" ]; then
  echo "no manifest at $SRC" >&2
  exit 1
fi

# Refuse to run against something that is not answering: a suite that
# "passes" against a dead host is worse than no suite.
code=$(curl -s -o /dev/null -w '%{http_code}' "$URL/" --max-time 30 || true)
case "$code" in
  200) ;;
  401|302|307|308)
    echo "$URL needs a password — set APP_PASSWORD blank for Preview, or use a local build" >&2
    exit 1 ;;
  *)
    echo "$URL answered $code — not running the suite against that" >&2
    exit 1 ;;
esac

# Point every URL in the manifest at this host.
sed -e "s|^url: .*|url: $URL/|" \
    -e "s|url: http://localhost:[0-9]*/|url: $URL/|g" \
    "$SRC" > "$OUT"

echo "suite → $URL"
cd "$RETAKE"
exec npx tsx src/cli.ts run "$OUT" --preset post-vertical --no-master
