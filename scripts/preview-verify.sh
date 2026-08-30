#!/usr/bin/env bash
#
# Deploy an isolated preview and run the recorded mobile suite against it.
#
#   scripts/preview-verify.sh [backup.json] [--full]
#
# This is the gate that caught what unit tests could not: the 60-second
# function ceiling killing Tidy, a Merge button that moved instead of
# merging, a stale receipt breaking flow timing. Local green is necessary,
# never sufficient — this is the sufficient half, scripted so it is nobody's
# personal discipline.
#
# Safety, by construction rather than care:
#   - the preview's hub is a dead address, so /api/sync answers 503 and
#     NOTHING the suite does can reach a real board (production shares one
#     hub with no pairing — pointed at it, the suite would write into it);
#   - the board is seeded into the browser's own IndexedDB from the backup
#     given, so no private data ships in the deploy;
#   - model keys come from .env.local and land only in this deployment's
#     env. Remove stale previews with scripts/preview-clean.sh when done.
#
# By default runs the suite up to the Tidy scene (~4 min). --full runs all
# 28 steps (~10 min).
set -euo pipefail

BACKUP="${1:-$(ls -t $HOME/Downloads/capture-backup-*.json 2>/dev/null | head -1)}"
[ -f "$BACKUP" ] || { echo "no backup export found — pass one: scripts/preview-verify.sh <backup.json>" >&2; exit 1; }
RETAKE="${RETAKE_DIR:-$HOME/Documents/Retake}"
[ -d "$RETAKE" ] || { echo "Retake workspace not found at $RETAKE" >&2; exit 1; }

cd "$(dirname "$0")/.."
set -a; . ./.env.local; set +a

echo "deploying isolated preview (dead hub, keys from .env.local)…"
URL=$(npx vercel deploy --yes --archive=tgz \
  --env UPSTASH_REDIS_REST_URL=http://127.0.0.1:1 \
  --env UPSTASH_REDIS_REST_TOKEN=disabled \
  --env APP_PASSWORD= \
  --env GROQ_API_KEY="${GROQ_API_KEY:-}" \
  --env GROQ_API_KEY_2="${GROQ_API_KEY_2:-}" \
  --env MISTRAL_API_KEY="${MISTRAL_API_KEY:-}" \
  --env GOOGLE_GENERATIVE_AI_API_KEY="${GOOGLE_GENERATIVE_AI_API_KEY:-}" \
  --env OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" 2>&1 \
  | tr '\r' '\n' | grep -oE "https://capture-[a-z0-9]+-[a-z0-9-]+\.vercel\.app" | tail -1)
[ -n "$URL" ] || { echo "deploy failed" >&2; exit 1; }
echo "preview: $URL"

SYNC=$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/sync" --max-time 40)
if [ "$SYNC" = "200" ]; then
  echo "REFUSING to run: this preview's hub is ALIVE ($SYNC) — the suite would write into a real board" >&2
  exit 1
fi
echo "hub isolation confirmed (sync answered $SYNC)"

if [ "${2:-}" = "--full" ]; then
  node scripts/lab-manifest.mjs "$URL" "$BACKUP" "$RETAKE/demos/capture-lab.yaml" >/dev/null
else
  node scripts/lab-manifest.mjs "$URL" "$BACKUP" "$RETAKE/demos/capture-lab.yaml" --gate >/dev/null
fi
echo "suite → $URL  (board from $(basename "$BACKUP"))"
cd "$RETAKE"
exec npx tsx src/cli.ts run demos/capture-lab.yaml --preset draft --no-master
