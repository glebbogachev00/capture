#!/usr/bin/env node
// R1 only: call /api/sort sequentially with a checked-in synthetic board.
// This script never reads environment files, cookies, credentials, or board APIs.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  assertCasePack,
  buildArtifact,
  detectBaselineRegressions,
  parseTarget,
  runSequentialBaseline,
} from "./routing-baseline-lib.mjs";

function outputOptions(args) {
  let out = "outputs/routing-baseline/latest.json";
  let compare = null;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--out" || arg === "--compare") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a JSON path`);
      if (arg === "--out") out = value;
      else compare = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { out: resolve(out), compare: compare ? resolve(compare) : null };
}

async function main() {
  const target = parseTarget(process.argv.slice(2));
  const { out, compare } = outputOptions(target.remainingArgs);
  const casePack = JSON.parse(await readFile(new URL("./routing-baseline-cases.json", import.meta.url), "utf8"));
  assertCasePack(casePack, { requireFullCoverage: true });

  const startedAt = new Date().toISOString();
  const execution = await runSequentialBaseline({ target, casePack });
  const finishedAt = new Date().toISOString();
  let artifact = buildArtifact({ target, casePack, startedAt, finishedAt, runs: execution.runs });

  let regressions = [];
  if (compare) {
    const baseline = JSON.parse(await readFile(compare, "utf8"));
    regressions = detectBaselineRegressions(baseline, artifact);
    artifact = buildArtifact({ target, casePack, startedAt, finishedAt, runs: execution.runs, regressions });
  }

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });

  for (const item of artifact.cases) {
    const via = item.providerVia ? ` via=${item.providerVia}` : "";
    console.log(`${item.pass ? "PASS" : "FAIL"} ${item.id} ${item.latencyMs}ms${via} [${item.reasonCodes.join(",")}]`);
  }
  console.log(JSON.stringify({ artifact: out, ...artifact.summary }));
  if (artifact.summary.failed || regressions.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`routing baseline aborted: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
