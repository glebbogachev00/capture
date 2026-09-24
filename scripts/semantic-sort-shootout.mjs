#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { evaluateOutput, observeOutput, validateTarget } from "./semantic-core-gate-lib.mjs";

const CASES_PATH = fileURLToPath(new URL("./semantic-core-release-cases.json", import.meta.url));
const EXACT_CASE_ID = "exact-four-action-report";
const REQUIRED_TERMS = ["signup", "pricing", "render", "onboarding"];
const TARGET_MS = 10_000;
const STOP_MS = 15_000;

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function integerArgument(name, fallback) {
  const value = Number(argument(name, String(fallback)));
  if (!Number.isSafeInteger(value) || value < 1 || value > 10) {
    throw new Error(`${name} must be an integer from 1 to 10.`);
  }
  return value;
}

function safeToken(value, name) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9._:/-]{1,160}$/u.test(value)) {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

function clientCalendarContext(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return {
    localDate: `${part("year")}-${part("month")}-${part("day")}`,
    timeZone: formatter.resolvedOptions().timeZone || "UTC",
  };
}

function failureKind(status) {
  if (status === 429) return "quota_failure";
  if (status === 422 || status === 502) return "provider_failure";
  return "infrastructure_failure";
}

function mentionChecks(output) {
  const actions = Array.isArray(output?.actions)
    ? output.actions.filter((action) => typeof action === "string")
    : [];
  const joined = actions.join(" ").toLocaleLowerCase("en");
  return Object.fromEntries(REQUIRED_TERMS.map((term) => [term, joined.includes(term)]));
}

/** Evaluation only: reject obvious copied clause wrappers without rewriting the
 * model output. Production semantics remain model-owned. */
function assessStandaloneActionText(action) {
  const text = action.trim();
  if (!text) return { text, standaloneImperative: false, reasonCode: "ACTION_TEXT_EMPTY" };
  if (/^(?:and|but|so|then)\b[\s,]*/iu.test(text)) {
    return { text, standaloneImperative: false, reasonCode: "ACTION_TEXT_LEADING_CONNECTIVE" };
  }
  if (/^i\s+(?:also\s+)?(?:need|should|must|have|want|plan|will)\b/iu.test(text)) {
    return { text, standaloneImperative: false, reasonCode: "ACTION_TEXT_FIRST_PERSON_FILLER" };
  }
  return { text, standaloneImperative: true, reasonCode: null };
}

function actionTextQuality(output) {
  const actions = Array.isArray(output?.actions)
    ? output.actions.filter((action) => typeof action === "string")
    : [];
  const rows = actions.map(assessStandaloneActionText);
  return { pass: rows.length > 0 && rows.every((row) => row.standaloneImperative), rows };
}

async function loadExactCase() {
  const release = JSON.parse(await readFile(CASES_PATH, "utf8"));
  const testCase = release.cases?.find((candidate) => candidate.id === EXACT_CASE_ID);
  if (!testCase || !testCase.raw || !Array.isArray(testCase.threads) || !testCase.expect) {
    throw new Error(`Missing complete ${EXACT_CASE_ID} fixture.`);
  }
  return testCase;
}

async function requestOnce({ base, provider, testCase, calendar }) {
  const started = performance.now();
  try {
    const response = await fetch(`${base}/api/sort`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw: testCase.raw, threads: testCase.threads, ...calendar }),
      redirect: "manual",
      signal: AbortSignal.timeout(STOP_MS),
    });
    let output = null;
    try {
      const text = await response.text();
      if (text.length <= 2_000_000) output = JSON.parse(text);
    } catch {}
    const durationMs = Math.round(performance.now() - started);
    if (!response.ok) {
      return {
        status: failureKind(response.status),
        httpStatus: response.status,
        durationMs,
        underTarget: durationMs < TARGET_MS,
        output: {
          kind: null,
          actionCount: 0,
          actionMentions: Object.fromEntries(REQUIRED_TERMS.map((term) => [term, false])),
          actionTextQuality: { pass: false, rows: [] },
          newThread: false,
          via: null,
        },
      };
    }
    const reasonCodes = evaluateOutput(testCase, output);
    if (output?.via !== provider) reasonCodes.push("OUTPUT_PROVIDER_PROVENANCE_MISMATCH");
    const textQuality = actionTextQuality(output);
    if (!textQuality.pass) reasonCodes.push("ACTION_TEXT_NOT_STANDALONE_IMPERATIVE");
    const observed = observeOutput(output);
    return {
      status: reasonCodes.length ? "semantic_failure" : "pass",
      reasonCodes: [...new Set(reasonCodes)],
      httpStatus: response.status,
      durationMs,
      underTarget: durationMs < TARGET_MS,
      output: {
        kind: observed.kind,
        actionCount: observed.actionCount,
        actionMentions: mentionChecks(output),
        actionTextQuality: textQuality,
        newThread: observed.threadRoute === "new",
        via: typeof output?.via === "string" ? output.via : null,
      },
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return {
      status: timedOut ? "timeout" : "infrastructure_failure",
      reasonCodes: [timedOut ? "REQUEST_TIMEOUT_15S" : "NETWORK_FAILURE"],
      httpStatus: null,
      durationMs,
      underTarget: false,
      output: {
        kind: null,
        actionCount: 0,
        actionMentions: Object.fromEntries(REQUIRED_TERMS.map((term) => [term, false])),
        actionTextQuality: { pass: false, rows: [] },
        newThread: false,
        via: null,
      },
    };
  }
}

async function atomicWrite(path, value) {
  const destination = resolve(path);
  const temporary = `${destination}.${process.pid}.tmp`;
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, destination);
}

const base = validateTarget(
  argument("--base", "http://localhost:3000"),
  process.argv.includes("--allow-remote"),
).origin;
const provider = safeToken(argument("--provider"), "--provider");
const model = safeToken(argument("--model"), "--model");
const repetitions = integerArgument("--repetitions", 3);
const artifactPath = argument("--artifact", `outputs/semantic-sort-shootout/${provider}.json`);
const testCase = await loadExactCase();
const calendar = clientCalendarContext();
const runs = [];
let disqualifyingFailures = 0;

for (let index = 0; index < repetitions; index += 1) {
  const run = await requestOnce({ base, provider, testCase, calendar });
  runs.push({ repetition: index + 1, ...run });
  if (run.status === "timeout" || run.durationMs > STOP_MS || run.status === "semantic_failure") {
    disqualifyingFailures += 1;
  }
  if (disqualifyingFailures >= 2) break;
}

const inputSha256 = createHash("sha256")
  .update(JSON.stringify({ raw: testCase.raw, threads: testCase.threads }))
  .digest("hex");
const artifact = {
  schemaVersion: 1,
  shootout: "capture-semantic-sort-exact-hard-case",
  provider,
  model,
  targetMs: TARGET_MS,
  stopMs: STOP_MS,
  requestedRepetitions: repetitions,
  completedRepetitions: runs.length,
  input: {
    id: testCase.id,
    sha256: inputSha256,
    expected: testCase.expect,
  },
  runs,
  verdict: runs.length === repetitions && runs.every((run) => run.status === "pass" && run.underTarget)
    ? "pass"
    : runs.some((run) => run.status === "semantic_failure")
      ? "semantic_failure"
      : runs.some((run) => run.status === "timeout" || !run.underTarget)
        ? "latency_failure"
        : "provider_failure",
};

await atomicWrite(artifactPath, artifact);
process.stdout.write(`${JSON.stringify(artifact)}\n`);
process.exitCode = artifact.verdict === "pass" ? 0 : 1;
