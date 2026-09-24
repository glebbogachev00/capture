#!/usr/bin/env node

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import {
  buildArtifact,
  classifyThrownFailure,
  clientCalendarContext,
  executeCase,
  loadReleaseCriticalCases,
  validateTarget,
} from "./semantic-core-gate-lib.mjs";

const DEFAULT_TARGET = "http://localhost:3000";
const DEFAULT_ARTIFACT = "outputs/semantic-core-gate.json";
const REQUEST_TIMEOUT_MS = 65_000;
const VERSION_TIMEOUT_MS = 10_000;
const MAX_RATE_LIMIT_RETRIES = 1;
const RETRY_CAP_MS = 10_000;
const BETWEEN_CASES_MS = 350;
const COOKIE_ENV = "CAPTURE_SEMANTIC_GATE_COOKIE";

const sleep = (milliseconds) => new Promise((resolveSleep) => {
  setTimeout(resolveSleep, milliseconds);
});

function usage() {
  return {
    gate: "capture-semantic-core",
    usage: "npm run --silent gate:semantic-core -- [--target <origin>] [--allow-remote] [--artifact <path>]",
    defaults: {
      target: DEFAULT_TARGET,
      artifact: DEFAULT_ARTIFACT,
    },
    cookieEnvironmentVariable: COOKIE_ENV,
  };
}

function parseArguments(argv) {
  const options = {
    target: DEFAULT_TARGET,
    artifact: DEFAULT_ARTIFACT,
    allowRemote: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-remote") {
      options.allowRemote = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--target" || argument === "--artifact") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      options[argument === "--target" ? "target" : "artifact"] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function cookieFromEnvironment() {
  const cookie = process.env[COOKIE_ENV];
  if (!cookie) return undefined;
  if (/[\r\n]/u.test(cookie)) {
    throw new Error(`${COOKIE_ENV} contains an invalid line break.`);
  }
  return cookie;
}

function versionHeaders(cookie) {
  const headers = { Accept: "application/json" };
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function versionHttpReason(status) {
  if (status === 401 || status === 403) return "INFRA_HTTP_AUTH";
  if (status >= 300 && status < 400) return "INFRA_HTTP_REDIRECT";
  if (status >= 400 && status < 500) return "INFRA_HTTP_CLIENT";
  return "INFRA_HTTP_SERVER";
}

async function buildIdentity(origin, cookie) {
  let response;
  try {
    response = await fetch(`${origin}/api/version`, {
      method: "GET",
      headers: versionHeaders(cookie),
      redirect: "manual",
      signal: AbortSignal.timeout(VERSION_TIMEOUT_MS),
    });
  } catch (error) {
    const failure = classifyThrownFailure(error);
    return { id: null, status: failure.status, reasonCode: failure.reasonCode };
  }

  let body = {};
  try {
    const text = await response.text();
    if (text.length > 10_000) throw new Error("version response too large");
    body = JSON.parse(text);
  } catch {
    if (!response.ok) {
      return {
        id: null,
        status: "infrastructure_failure",
        reasonCode: versionHttpReason(response.status),
      };
    }
    return { id: null, status: "infrastructure_failure", reasonCode: "INFRA_INVALID_JSON" };
  }
  if (!response.ok) {
    return {
      id: null,
      status: "infrastructure_failure",
      reasonCode: versionHttpReason(response.status),
    };
  }
  if (
    typeof body?.build !== "string" ||
    !/^[a-zA-Z0-9._:-]{1,200}$/u.test(body.build)
  ) {
    return { id: null, status: "infrastructure_failure", reasonCode: "INFRA_INVALID_VERSION" };
  }
  return { id: body.build, status: "ok", reasonCode: null };
}

async function writeArtifact(path, artifact) {
  const destination = resolve(path);
  const temporary = `${destination}.${process.pid}.tmp`;
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, destination);
}

function machineError(reasonCode) {
  return {
    schemaVersion: 1,
    gate: "capture-semantic-core",
    status: "configuration_failure",
    reasonCode,
  };
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch {
    process.stdout.write(`${JSON.stringify(machineError("ARGUMENT_INVALID"))}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(`${JSON.stringify(usage(), null, 2)}\n`);
    return;
  }

  let target;
  let cookie;
  let cases;
  try {
    target = validateTarget(options.target, options.allowRemote);
    cookie = cookieFromEnvironment();
    cases = await loadReleaseCriticalCases();
  } catch {
    process.stdout.write(`${JSON.stringify(machineError("CONFIGURATION_REJECTED"))}\n`);
    process.exitCode = 2;
    return;
  }

  const wallStarted = new Date();
  const monotonicStarted = performance.now();
  const build = await buildIdentity(target.origin, cookie);
  const results = [];
  let rateLimitRetries = 0;

  if (build.status === "ok") {
    const calendar = clientCalendarContext();
    for (let index = 0; index < cases.length; index += 1) {
      const result = await executeCase({
        origin: target.origin,
        testCase: cases[index],
        calendar,
        cookie,
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxRateLimitRetries: MAX_RATE_LIMIT_RETRIES,
        retryCapMs: RETRY_CAP_MS,
      });
      results.push(result);
      rateLimitRetries += result.rateLimitRetries;
      if ([
        "infrastructure_failure",
        "provider_failure",
        "quota_failure",
      ].includes(result.status)) {
        break;
      }
      if (index < cases.length - 1) await sleep(BETWEEN_CASES_MS);
    }
  }

  const wallFinished = new Date();
  const artifact = buildArtifact({
    target,
    build,
    cases,
    results,
    startedAt: wallStarted.toISOString(),
    finishedAt: wallFinished.toISOString(),
    durationMs: performance.now() - monotonicStarted,
    rateLimitRetries,
  });

  try {
    await writeArtifact(options.artifact, artifact);
  } catch {
    process.stdout.write(`${JSON.stringify(machineError("ARTIFACT_WRITE_FAILED"))}\n`);
    process.exitCode = 2;
    return;
  }

  process.stdout.write(`${JSON.stringify(artifact)}\n`);
  process.exitCode = artifact.status === "pass"
    ? 0
    : artifact.status === "semantic_failure"
      ? 1
      : 2;
}

await main();
