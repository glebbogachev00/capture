import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const SORT_CASES_URL = new URL("../src/lib/sortCases.json", import.meta.url);
const RELEASE_CASES_URL = new URL("./semantic-core-release-cases.json", import.meta.url);

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const OUTPUT_KINDS = new Set(["action", "thread", "intention", "both"]);
const RESULT_STATUSES = new Set([
  "pass",
  "semantic_failure",
  "infrastructure_failure",
  "provider_failure",
  "quota_failure",
]);

function previewHostname(hostname) {
  if (!hostname.endsWith(".vercel.app")) return false;
  const label = hostname.slice(0, -".vercel.app".length);
  if (label.includes("-git-")) return true;
  const segments = label.split("-");
  return segments.slice(1, -1).some((segment) => (
    segment.length >= 6 && /[a-z]/u.test(segment) && /\d/u.test(segment)
  ));
}

export function validateTarget(value, allowRemote = false) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error("Target must be an absolute HTTP(S) origin.");
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error("Target must use HTTP(S).");
  }
  if (target.username || target.password) {
    throw new Error("Target URL must not contain credentials.");
  }
  if (
    target.pathname !== "/" ||
    target.search ||
    target.hash
  ) {
    throw new Error("Target must be an origin without a path, query, or fragment.");
  }

  const hostname = target.hostname.toLowerCase();
  if (LOCAL_HOSTS.has(hostname)) {
    return { origin: target.origin, kind: "localhost" };
  }
  if (!allowRemote) {
    throw new Error("Remote targets are denied; pass --allow-remote for an authorized disposable Preview.");
  }
  if (target.protocol !== "https:") {
    throw new Error("Remote targets must use HTTPS.");
  }
  if (target.port || !previewHostname(hostname)) {
    throw new Error("Remote target must be a Vercel Preview host, not a production alias.");
  }
  return { origin: target.origin, kind: "vercel-preview" };
}

export function clientCalendarContext(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) {
    throw new Error("Could not resolve the client-local calendar date.");
  }
  return {
    localDate: `${year}-${month}-${day}`,
    timeZone: formatter.resolvedOptions().timeZone || "UTC",
  };
}

function cookieHeaders(cookie) {
  const headers = { "Content-Type": "application/json" };
  if (cookie === undefined || cookie === null || cookie === "") return headers;
  if (typeof cookie !== "string" || /[\r\n]/u.test(cookie)) {
    throw new Error("Cookie environment value is invalid.");
  }
  headers.Cookie = cookie;
  return headers;
}

/** The only helper that constructs a live /api/sort request. */
export function buildSortRequest(origin, testCase, calendar, cookie) {
  return {
    url: `${origin}/api/sort`,
    init: {
      method: "POST",
      headers: cookieHeaders(cookie),
      body: JSON.stringify({
        raw: testCase.raw,
        threads: testCase.threads,
        localDate: calendar.localDate,
        timeZone: calendar.timeZone,
      }),
      redirect: "manual",
    },
  };
}

function readJson(url) {
  return readFile(url, "utf8").then((text) => JSON.parse(text));
}

export async function loadReleaseCriticalCases() {
  const [sortCases, releasePack] = await Promise.all([
    readJson(SORT_CASES_URL),
    readJson(RELEASE_CASES_URL),
  ]);
  if (!Array.isArray(sortCases) || !Array.isArray(releasePack?.cases)) {
    throw new Error("Semantic case data is malformed.");
  }
  const byId = new Map(sortCases.map((testCase) => [testCase.id, testCase]));
  return releasePack.cases.map((entry) => {
    if (!entry.fromSortCase) return { ...entry, sourceCaseId: null };
    const source = byId.get(entry.fromSortCase);
    if (!source) {
      throw new Error(`Release-critical source case is missing: ${entry.fromSortCase}`);
    }
    return {
      ...source,
      id: entry.id,
      sourceCaseId: entry.fromSortCase,
    };
  });
}

function addReason(reasons, reason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

export function evaluateOutput(testCase, output) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return ["OUTPUT_NOT_OBJECT"];
  }
  const expect = testCase.expect ?? {};
  const reasons = [];
  const actions = Array.isArray(output.actions)
    ? output.actions.filter((action) => typeof action === "string")
    : [];
  const actionMeta = Array.isArray(output.actionMeta) ? output.actionMeta : [];

  if (actionMeta.length !== actions.length) {
    addReason(reasons, "OUTPUT_ACTION_META_COUNT_MISMATCH");
  }
  for (const row of actionMeta) {
    if (!row || typeof row !== "object" || typeof row.source !== "string" || !row.source.trim()) {
      addReason(reasons, "OUTPUT_ACTION_SOURCE_MISSING");
    }
    if (!['hours', 'days', 'weeks', 'keep'].includes(row?.shelfLife)) {
      addReason(reasons, "OUTPUT_ACTION_SHELF_LIFE_INVALID");
    }
  }
  if (!Array.isArray(expect.kindOneOf) || !expect.kindOneOf.includes(output.kind)) {
    addReason(reasons, "OUTPUT_KIND_UNEXPECTED");
  }
  if (expect.noActions && actions.length > 0) {
    addReason(reasons, "OUTPUT_ACTIONS_NOT_EMPTY");
  }
  if (Array.isArray(expect.actionsBetween)) {
    const [minimum, maximum] = expect.actionsBetween;
    if (actions.length < minimum || actions.length > maximum) {
      addReason(reasons, "OUTPUT_ACTION_COUNT_OUT_OF_RANGE");
    }
  }
  if (Array.isArray(expect.actionsMention)) {
    const joined = actions.join(" ").toLocaleLowerCase("en");
    for (const term of expect.actionsMention) {
      if (!joined.includes(String(term).toLocaleLowerCase("en"))) {
        addReason(reasons, "OUTPUT_ACTION_MISSING_REQUIRED_TERM");
      }
    }
  }
  if (expect.routeTo && output.threadId !== expect.routeTo) {
    addReason(reasons, "OUTPUT_THREAD_ROUTE_MISMATCH");
  }
  if (expect.newThread && (output.threadId !== null || !output.threadName)) {
    addReason(reasons, "OUTPUT_NEW_THREAD_REQUIRED");
  }
  if (Array.isArray(expect.shelfIn) && !expect.shelfIn.includes(output.shelfLife)) {
    addReason(reasons, "OUTPUT_SHELF_LIFE_UNEXPECTED");
  }
  if (expect.hasDue && !output.due) {
    addReason(reasons, "OUTPUT_DUE_REQUIRED");
  }
  if (expect.noDue && output.due) {
    addReason(reasons, "OUTPUT_DUE_NOT_ALLOWED");
  }

  const clean = typeof output.clean === "string" ? output.clean : "";
  if (expect.cleanParagraphs) {
    const paragraphCount = clean.split(/\n\s*\n/u).filter((part) => part.trim()).length;
    if (paragraphCount < expect.cleanParagraphs) {
      addReason(reasons, "OUTPUT_CLEAN_PARAGRAPHS_TOO_FEW");
    }
  }
  if (expect.cleanBullets) {
    const bulletCount = clean.split(/\n/u).filter((line) => /^\s*-\s+/u.test(line)).length;
    if (bulletCount < expect.cleanBullets) {
      addReason(reasons, "OUTPUT_CLEAN_BULLETS_TOO_FEW");
    }
  }
  if (!safeVia(output.via)) {
    addReason(reasons, "OUTPUT_VIA_MISSING");
  }
  return reasons;
}

export function classifyHttpFailure(status, body = {}) {
  const message = typeof body?.error === "string" ? body.error.toLowerCase() : "";
  if (status === 429) {
    return { status: "quota_failure", reasonCode: "QUOTA_RATE_LIMIT_EXHAUSTED" };
  }
  if (/quota|credit|billing|resource exhausted|rate.?limit|too many requests/u.test(message)) {
    return { status: "quota_failure", reasonCode: "QUOTA_EXHAUSTED" };
  }
  if (status === 422) {
    return { status: "provider_failure", reasonCode: "PROVIDER_REJECTED_OUTPUT" };
  }
  if (status === 502) {
    return { status: "provider_failure", reasonCode: "PROVIDER_FAILURE" };
  }
  if (/no (?:ai )?provider|provider.*(?:unavailable|configured)|model.*unavailable|api key/u.test(message)) {
    return { status: "provider_failure", reasonCode: "PROVIDER_UNAVAILABLE" };
  }
  if (/provider|model generation|ai service/u.test(message)) {
    return { status: "provider_failure", reasonCode: "PROVIDER_FAILURE" };
  }
  if (status === 401 || status === 403) {
    return { status: "infrastructure_failure", reasonCode: "INFRA_HTTP_AUTH" };
  }
  if (status >= 300 && status < 400) {
    return { status: "infrastructure_failure", reasonCode: "INFRA_HTTP_REDIRECT" };
  }
  if (status >= 400 && status < 500) {
    return { status: "infrastructure_failure", reasonCode: "INFRA_HTTP_CLIENT" };
  }
  return { status: "infrastructure_failure", reasonCode: "INFRA_HTTP_SERVER" };
}

export function classifyThrownFailure(error) {
  const name = typeof error?.name === "string" ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return { status: "infrastructure_failure", reasonCode: "INFRA_REQUEST_TIMEOUT" };
  }
  return { status: "infrastructure_failure", reasonCode: "INFRA_NETWORK_ERROR" };
}

function retryAfterMilliseconds(value, capMs, now = Date.now()) {
  if (!value) return Math.min(1_000, capMs);
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1_000), capMs);
  }
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return Math.min(1_000, capMs);
  return Math.min(Math.max(0, at - now), capMs);
}

async function responseJson(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 2_000_000) {
    throw new Error("response too large");
  }
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error("response too large");
  return JSON.parse(text);
}

export async function executeCase({
  origin,
  testCase,
  calendar,
  cookie,
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  timeoutMs = 65_000,
  maxRateLimitRetries = 1,
  retryCapMs = 10_000,
}) {
  const started = performance.now();
  let attempts = 0;
  let rateLimitRetries = 0;

  while (attempts <= maxRateLimitRetries) {
    attempts += 1;
    const request = buildSortRequest(origin, testCase, calendar, cookie);
    let response;
    try {
      response = await fetchImpl(request.url, {
        ...request.init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const failure = classifyThrownFailure(error);
      return {
        ...testCase,
        ...failure,
        reasonCodes: [failure.reasonCode],
        via: null,
        observed: { ...EMPTY_OBSERVED },
        attempts,
        rateLimitRetries,
        durationMs: performance.now() - started,
      };
    }

    if (response.status === 429 && rateLimitRetries < maxRateLimitRetries) {
      const waitMs = retryAfterMilliseconds(
        response.headers.get("retry-after"),
        retryCapMs,
      );
      rateLimitRetries += 1;
      await sleep(waitMs);
      continue;
    }
    if (response.status === 429) {
      return {
        ...testCase,
        status: "quota_failure",
        reasonCodes: ["QUOTA_RATE_LIMIT_EXHAUSTED"],
        via: null,
        observed: { ...EMPTY_OBSERVED },
        attempts,
        rateLimitRetries,
        durationMs: performance.now() - started,
      };
    }

    let body;
    try {
      body = await responseJson(response);
    } catch {
      if (!response.ok) {
        const failure = classifyHttpFailure(response.status, {});
        return {
          ...testCase,
          status: failure.status,
          reasonCodes: [failure.reasonCode],
          via: null,
          observed: { ...EMPTY_OBSERVED },
          attempts,
          rateLimitRetries,
          durationMs: performance.now() - started,
        };
      }
      return {
        ...testCase,
        status: "infrastructure_failure",
        reasonCodes: ["INFRA_INVALID_JSON"],
        via: null,
        observed: { ...EMPTY_OBSERVED },
        attempts,
        rateLimitRetries,
        durationMs: performance.now() - started,
      };
    }

    if (!response.ok) {
      const failure = classifyHttpFailure(response.status, body);
      return {
        ...testCase,
        status: failure.status,
        reasonCodes: [failure.reasonCode],
        via: null,
        observed: { ...EMPTY_OBSERVED },
        attempts,
        rateLimitRetries,
        durationMs: performance.now() - started,
      };
    }

    const reasonCodes = evaluateOutput(testCase, body);
    return {
      ...testCase,
      status: reasonCodes.length ? "semantic_failure" : "pass",
      reasonCodes,
      via: safeVia(body?.via),
      observed: observeOutput(body),
      attempts,
      rateLimitRetries,
      durationMs: performance.now() - started,
    };
  }

  throw new Error("unreachable rate-limit retry state");
}

export function hashCaseInput(testCase) {
  return createHash("sha256")
    .update(JSON.stringify({ raw: testCase.raw, threads: testCase.threads ?? [] }))
    .digest("hex");
}

function safeVia(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._:/-]{1,120}$/u.test(value)
    ? value
    : null;
}

export function observeOutput(output) {
  const actions = Array.isArray(output?.actions)
    ? output.actions.filter((action) => typeof action === "string")
    : [];
  const clean = typeof output?.clean === "string" ? output.clean : "";
  return {
    kind: OUTPUT_KINDS.has(output?.kind) ? output.kind : null,
    actionCount: actions.length,
    hasDue: Boolean(output?.due),
    threadRoute: output?.threadId
      ? "existing"
      : output?.threadName
        ? "new"
        : "none",
    paragraphCount: clean
      ? clean.split(/\n\s*\n/u).filter((part) => part.trim()).length
      : 0,
    bulletCount: clean.split(/\n/u).filter((line) => /^\s*-\s+/u.test(line)).length,
  };
}

const EMPTY_OBSERVED = Object.freeze({
  kind: null,
  actionCount: 0,
  hasDue: false,
  threadRoute: "none",
  paragraphCount: 0,
  bulletCount: 0,
});

export function sanitizeResult(candidate) {
  const status = RESULT_STATUSES.has(candidate.status)
    ? candidate.status
    : "infrastructure_failure";
  const reasonCodes = Array.isArray(candidate.reasonCodes)
    ? [...new Set(candidate.reasonCodes.filter((reason) => (
      typeof reason === "string" && /^[A-Z][A-Z0-9_]{2,80}$/u.test(reason)
    )))]
    : [];
  return {
    id: String(candidate.id),
    sourceCaseId: candidate.sourceCaseId ? String(candidate.sourceCaseId) : null,
    inputSha256: hashCaseInput(candidate),
    status,
    reasonCodes,
    via: safeVia(candidate.via ?? candidate.output?.via),
    observed: candidate.observed && typeof candidate.observed === "object"
      ? {
          kind: OUTPUT_KINDS.has(candidate.observed.kind) ? candidate.observed.kind : null,
          actionCount: Number.isSafeInteger(candidate.observed.actionCount) ? candidate.observed.actionCount : 0,
          hasDue: candidate.observed.hasDue === true,
          threadRoute: ["existing", "new", "none"].includes(candidate.observed.threadRoute)
            ? candidate.observed.threadRoute
            : "none",
          paragraphCount: Number.isSafeInteger(candidate.observed.paragraphCount)
            ? candidate.observed.paragraphCount
            : 0,
          bulletCount: Number.isSafeInteger(candidate.observed.bulletCount)
            ? candidate.observed.bulletCount
            : 0,
        }
      : { ...EMPTY_OBSERVED },
    attempts: Number.isSafeInteger(candidate.attempts) ? candidate.attempts : 0,
    rateLimitRetries: Number.isSafeInteger(candidate.rateLimitRetries)
      ? candidate.rateLimitRetries
      : 0,
    durationMs: Number.isFinite(candidate.durationMs) ? Math.max(0, Math.round(candidate.durationMs)) : 0,
  };
}

function count(results, status) {
  return results.filter((result) => result.status === status).length;
}

export function buildArtifact({
  target,
  build,
  cases,
  results,
  startedAt,
  finishedAt,
  durationMs,
  rateLimitRetries = 0,
}) {
  const sanitizedResults = results.map((result) => sanitizeResult(result));
  const totals = {
    selected: cases.length,
    attempted: sanitizedResults.length,
    passed: count(sanitizedResults, "pass"),
    semanticFailures: count(sanitizedResults, "semantic_failure"),
    infrastructureFailures: count(sanitizedResults, "infrastructure_failure"),
    providerFailures: count(sanitizedResults, "provider_failure"),
    quotaFailures: count(sanitizedResults, "quota_failure"),
    rateLimitRetries,
  };
  const operationalFailures = (
    totals.infrastructureFailures + totals.providerFailures + totals.quotaFailures
  );
  const status = build.status !== "ok" || operationalFailures > 0
    ? "inconclusive"
    : totals.semanticFailures > 0
      ? "semantic_failure"
      : totals.passed === totals.selected
        ? "pass"
        : "inconclusive";
  return {
    schemaVersion: 1,
    gate: "capture-semantic-core",
    casePack: "release-critical",
    status,
    target: {
      origin: target.origin,
      kind: target.kind,
    },
    build: {
      id: build.id ?? null,
      status: build.status,
      reasonCode: build.reasonCode ?? null,
    },
    timing: {
      startedAt,
      finishedAt,
      durationMs: Math.max(0, Math.round(durationMs)),
    },
    totals,
    results: sanitizedResults,
  };
}
