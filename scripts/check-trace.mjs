/*
 * Nothing private may enter the deployment package.
 *
 * Next writes a `.nft.json` manifest beside every server route listing the
 * files that route might read. A deployment packager can bundle exactly
 * those files. `hubStore` builds its paths at runtime from SYNC_DATA_DIR,
 * which the tracer cannot follow, so it assumed the route might read
 * anything under the project root — and on a development machine that root
 * holds the real board. The manifests for /api/sync and /api/img each listed
 * thirteen private files: the live sync.json, an older snapshot of it, and
 * the exported ledger, corrections, actions, intentions and principles.
 *
 * Nothing had shipped. It was found by a review reading the manifests by
 * hand, which is not a control — so this is the control. It runs as part of
 * `npm run check`, after the build, and fails the check if a single one of
 * those paths reappears.
 *
 *   node scripts/check-trace.mjs [distDir]
 */

import fs from "node:fs";
import path from "node:path";

const dist = process.argv[2] || process.env.NEXT_DIST_DIR || ".next";

/* Directories that hold data, never code. No route can legitimately need to
   read one at runtime, so any appearance in a trace is a defect. */
const FORBIDDEN = [".data/", "CaptureVault/", "outputs/", "capture-backup"];

function manifests(dir) {
  const found = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".nft.json")) found.push(full);
    }
  };
  walk(dir);
  return found;
}

const files = manifests(dist);
if (!files.length) {
  console.error(
    `no trace manifests under ${dist}/ — run a build first, or pass the dist dir`
  );
  process.exit(1);
}

let offences = 0;
for (const file of files) {
  let listed;
  try {
    listed = JSON.parse(fs.readFileSync(file, "utf8")).files ?? [];
  } catch {
    continue;
  }
  const bad = listed.filter((f) => FORBIDDEN.some((k) => f.includes(k)));
  if (!bad.length) continue;
  offences += bad.length;
  console.error(`\n${file.replace(dist + "/", "")}  — ${bad.length} private path(s):`);
  for (const b of bad.slice(0, 10)) console.error(`    ${b}`);
  if (bad.length > 10) console.error(`    …and ${bad.length - 10} more`);
}

if (offences) {
  console.error(
    `\n${offences} private path(s) in the deployment trace across ${files.length} manifests.` +
      `\nAdd them to outputFileTracingExcludes in next.config.ts before deploying.`
  );
  process.exit(1);
}

console.log(`trace clean: ${files.length} manifests, no private paths`);
