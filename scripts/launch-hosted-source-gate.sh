#!/usr/bin/env bash
# Local-only preflight for the hosted acceptance session.
#
# This intentionally uses synthetic Vitest providers, socket-only disposable
# PostgreSQL clusters, and the VM-backed image acceptance client. It does not
# load environment files, call Supabase/Polar, deploy, or mutate hosted data.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "== Hosted launch source gate: tenant/auth/billing/storage tests =="
npm run test -- --maxWorkers=1 \
  src/lib/cloudIdentity.test.ts \
  src/lib/cloudOwnership.test.ts \
  src/lib/cloudRoute.test.ts \
  src/lib/cloudBoard.test.ts \
  src/lib/cloudSyncBridge.test.ts \
  src/lib/cloudSubscription.test.ts \
  src/lib/cloudSubscriptionRoute.test.ts \
  src/lib/polar.test.ts \
  src/lib/polarSignature.test.ts \
  src/lib/polarCheckoutEligibility.test.ts \
  src/lib/polarReconciliation.test.ts \
  src/lib/cloudImageRoute.test.ts \
  src/lib/cloudImageMigration.test.ts \
  src/lib/imgSync.test.ts \
  src/lib/backup.cloudRecovery.test.ts \
  src/hooks/useBoard.accountIsolation.test.ts \
  src/hooks/useBoard.offline.test.ts \
  src/lib/ownership.test.ts \
  src/lib/ownership.transport.test.ts \
  src/lib/ownership.importConsent.test.ts

echo "== Hosted launch source gate: disposable billing SQL =="
python3 scripts/run-polar-sql-local.py

echo "== Hosted launch source gate: blocked legacy publication SQL =="
python3 scripts/test-image-publication-sql.py

echo "== Hosted launch source gate: fresh publication SQL =="
python3 scripts/test-image-publication-sql.py --fresh

echo "== Hosted launch source gate: synthetic five-round browser client =="
node scripts/test-image-publication-batch.cjs

echo "PASS: hosted source gate is green; hosted credentials/provider behavior remain manual."
