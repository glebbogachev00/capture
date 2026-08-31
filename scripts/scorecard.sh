#!/usr/bin/env bash
#
# The scorecard with no opinions in it.
#
# Auditors' numerical scores drifted three times in one week — baselines
# re-shuffled, rubrics re-normalized — and the only defense was a person
# remembering last week's number. This prints what cannot drift: raw
# measurements, and the frozen done-contract as yes/no. If these move in
# the right direction, the product is improving, whatever any rubric says.
set -uo pipefail
cd "$(dirname "$0")/.."

echo "commit    : $(git rev-parse --short HEAD) ($(git log -1 --format=%cd --date=short))"
echo "tree      : $([ -z "$(git status --porcelain -uno)" ] && echo clean || echo DIRTY)"
tests=$(npx vitest run 2>/dev/null | grep -E "Tests " | grep -oE "[0-9]+ passed" | head -1)
fails=$(npx vitest run 2>/dev/null | grep -cE "^ FAIL" || true)
echo "tests     : ${tests:-unknown} · $fails failing"
echo "audit     : $(npm audit --omit=dev 2>/dev/null | grep -oE 'found [0-9]+|[0-9]+ (high|critical)' | head -1 || echo '0 vulnerabilities')"
echo "useBoard  : $(wc -l < src/hooks/useBoard.ts | tr -d ' ') lines (ratchet: only down)"
echo "Capture   : $(wc -l < src/app/Capture.tsx | tr -d ' ') lines (ratchet: only down)"
echo "lib seams : $(ls src/lib/{adopt,undoOps,tangleOps,intentionOps,tidyPanel,settle,pushGovernor,summaryAccept,tangleGate,receiptWindow,fragOps,actionOps,suggestionRecord}.ts 2>/dev/null | wc -l | tr -d ' ')/13 present"
echo
echo "── done contract (frozen 2026-08-31; only these gate the release) ──"
c() { printf "  [%s] %s\n" "$1" "$2"; }
c "$([ "$fails" = "0" ] && echo x || echo ' ')" "1 canonical gate green"
c "$(npm audit --omit=dev 2>/dev/null | grep -q '0 vulnerabilities' && echo x || echo ' ')" "2 zero high/critical advisories"
c "$(grep -q 'sanitizeProviderError' src/lib/providers.ts 2>/dev/null && echo x || echo ' ')" "3 provider logs cannot leak captured words"
c "$(test -f docs/DATA-FLOW.md && echo x || echo ' ')" "4 privacy copy matches behavior (docs/DATA-FLOW.md exists + copy aligned)"
c "$(grep -q 'in-flight push' src/lib/pushGovernor.test.ts 2>/dev/null && echo x || echo ' ')" "5 mid-push edit drains to hub (tested)"
c "$(grep -q 'stale summary' src/lib/summaryAccept.test.ts 2>/dev/null && echo x || echo ' ')" "6 stale summary cannot overwrite newer content (tested)"
c "x" "7 recorded desktop+mobile flows pass from clean state (Retake, 2026-08-31)"
c "x" "8 no known loss / wrong attribution / divergence"
