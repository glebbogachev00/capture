#!/usr/bin/env bash
#
# Remove every preview deployment. Previews carry live model keys with no
# app password; leaving them standing is quota anyone can burn. Production
# deployments are untouched.
set -euo pipefail
cd "$(dirname "$0")/.."
for u in $(npx vercel ls 2>&1 | grep -E "Preview" | awk '{print $3}'); do
  npx vercel remove "$u" --yes 2>&1 | grep -E "Removed|Error" | head -1
done
echo "previews remaining: $(npx vercel ls 2>&1 | grep -cE 'Preview' || true)"
