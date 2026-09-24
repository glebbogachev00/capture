import assert from "node:assert/strict";
import test from "node:test";

import {
  buildArtifact,
  buildSortRequest,
  classifyHttpFailure,
  classifyThrownFailure,
  evaluateOutput,
  executeCase,
  loadReleaseCriticalCases,
  sanitizeResult,
  validateTarget,
} from "./semantic-core-gate-lib.mjs";

test("URL safety allows loopback origins without remote authorization", () => {
  assert.deepEqual(validateTarget("http://localhost:3000", false), {
    origin: "http://localhost:3000",
    kind: "localhost",
  });
  assert.deepEqual(validateTarget("https://127.0.0.1:3443/", false), {
    origin: "https://127.0.0.1:3443",
    kind: "localhost",
  });
  assert.deepEqual(validateTarget("http://[::1]:3000", false), {
    origin: "http://[::1]:3000",
    kind: "localhost",
  });
});

test("URL safety denies remote, non-HTTPS, non-Vercel, and alias-shaped targets", () => {
  assert.throws(
    () => validateTarget("https://capture-git-gate-team.vercel.app", false),
    /--allow-remote/,
  );
  assert.throws(
    () => validateTarget("http://capture-git-gate-team.vercel.app", true),
    /HTTPS/,
  );
  assert.throws(
    () => validateTarget("https://preview.example.com", true),
    /Vercel Preview/,
  );
  assert.throws(
    () => validateTarget("https://capture.vercel.app", true),
    /Preview/,
  );
  assert.throws(
    () => validateTarget("https://user:password@capture-git-gate-team.vercel.app", true),
    /credentials/,
  );
  assert.throws(
    () => validateTarget("https://capture-git-gate-team.vercel.app/app", true),
    /origin/,
  );
  assert.deepEqual(validateTarget("https://capture-git-gate-team.vercel.app", true), {
    origin: "https://capture-git-gate-team.vercel.app",
    kind: "vercel-preview",
  });
  assert.deepEqual(validateTarget("https://capture-a1b2c3-team.vercel.app", true), {
    origin: "https://capture-a1b2c3-team.vercel.app",
    kind: "vercel-preview",
  });
  assert.throws(
    () => validateTarget("https://capture-semantic-core.vercel.app", true),
    /Preview/,
  );
});

test("request helper emits the current flat localDate/timeZone body and optional in-memory Cookie", () => {
  const request = buildSortRequest(
    "https://capture-git-gate-team.vercel.app",
    { raw: "private input", threads: [{ id: "t-1", name: "One", about: "Subject" }] },
    { localDate: "2026-09-24", timeZone: "Asia/Bangkok" },
    "capture_session=secret",
  );

  assert.equal(request.url, "https://capture-git-gate-team.vercel.app/api/sort");
  assert.deepEqual(request.init.headers, {
    "Content-Type": "application/json",
    Cookie: "capture_session=secret",
  });
  assert.deepEqual(JSON.parse(request.init.body), {
    raw: "private input",
    threads: [{ id: "t-1", name: "One", about: "Subject" }],
    localDate: "2026-09-24",
    timeZone: "Asia/Bangkok",
  });
  assert.equal("clientDate" in JSON.parse(request.init.body), false);
});

test("release-critical pack reuses named sort cases and includes the exact four-action report", async () => {
  const cases = await loadReleaseCriticalCases();
  assert.deepEqual(cases.map(({ id }) => id), [
    "exact-four-action-report",
    "obvious-existing-thread-reuse",
    "unrelated-name-trap",
    "context-misuse-two-action",
    "mixed-thinking-deadline",
    "new-subject",
    "rambling-multi-topic-formatting",
  ]);
  assert.equal(cases[0].expect.actionsBetween[0], 4);
  assert.equal(cases[0].expect.actionsBetween[1], 4);
  assert.match(cases[0].raw, /signup error/);
  assert.match(cases[0].raw, /release assistant/);
  assert.equal(cases[1].sourceCaseId, "no-duplicate-thread");
  assert.equal(cases[2].sourceCaseId, "name-word-trap");
  assert.equal(cases[3].sourceCaseId, "context-misuse-omitted-action");
});

test("oracle can go red with exact output-level reason codes", () => {
  const testCase = {
    expect: {
      kindOneOf: ["both"],
      actionsBetween: [2, 2],
      actionsMention: ["doctor"],
      routeTo: "t-correct",
      hasDue: true,
      cleanParagraphs: 2,
    },
  };
  const reasonCodes = evaluateOutput(testCase, {
    kind: "thread",
    actions: ["Buy milk"],
    actionMeta: [],
    threadId: "t-wrong",
    due: null,
    clean: "one block",
    via: "fixture-provider",
  });

  assert.deepEqual(reasonCodes, [
    "OUTPUT_ACTION_META_COUNT_MISMATCH",
    "OUTPUT_KIND_UNEXPECTED",
    "OUTPUT_ACTION_COUNT_OUT_OF_RANGE",
    "OUTPUT_ACTION_MISSING_REQUIRED_TERM",
    "OUTPUT_THREAD_ROUTE_MISMATCH",
    "OUTPUT_DUE_REQUIRED",
    "OUTPUT_CLEAN_PARAGRAPHS_TOO_FEW",
  ]);
});

test("status classification separates quota, provider, and infrastructure failures", () => {
  assert.deepEqual(classifyHttpFailure(429, { error: "rate limited" }), {
    status: "quota_failure",
    reasonCode: "QUOTA_RATE_LIMIT_EXHAUSTED",
  });
  assert.deepEqual(classifyHttpFailure(503, { error: "AI provider quota exhausted" }), {
    status: "quota_failure",
    reasonCode: "QUOTA_EXHAUSTED",
  });
  assert.deepEqual(classifyHttpFailure(422, {
    error: "Could not safely separate every part of that capture.",
  }), {
    status: "provider_failure",
    reasonCode: "PROVIDER_REJECTED_OUTPUT",
  });
  assert.deepEqual(classifyHttpFailure(503, { error: "No AI provider configured" }), {
    status: "provider_failure",
    reasonCode: "PROVIDER_UNAVAILABLE",
  });
  assert.deepEqual(classifyHttpFailure(502, { error: "The sort didn't go through." }), {
    status: "provider_failure",
    reasonCode: "PROVIDER_FAILURE",
  });
  assert.deepEqual(classifyHttpFailure(401, { error: "Unauthorized" }), {
    status: "infrastructure_failure",
    reasonCode: "INFRA_HTTP_AUTH",
  });
  assert.deepEqual(classifyHttpFailure(500, { error: "Internal Server Error" }), {
    status: "infrastructure_failure",
    reasonCode: "INFRA_HTTP_SERVER",
  });
  assert.deepEqual(classifyThrownFailure(Object.assign(new Error("timed out"), {
    name: "TimeoutError",
  })), {
    status: "infrastructure_failure",
    reasonCode: "INFRA_REQUEST_TIMEOUT",
  });
  assert.deepEqual(classifyThrownFailure(new Error("connect ECONNREFUSED")), {
    status: "infrastructure_failure",
    reasonCode: "INFRA_NETWORK_ERROR",
  });
});

test("case execution retries one bounded rate limit and remains sequential", async () => {
  const responses = [
    new Response(JSON.stringify({ error: "rate limited" }), {
      status: 429,
      headers: { "Retry-After": "0", "Content-Type": "application/json" },
    }),
    Response.json({
      kind: "thread",
      actions: [],
      actionMeta: [],
      clean: "A durable thought",
      threadId: null,
      threadName: "Durable thought",
      due: null,
      via: "fixture-provider",
    }),
  ];
  const calls = [];
  const sleeps = [];
  const result = await executeCase({
    origin: "http://localhost:3000",
    testCase: {
      id: "retry-case",
      sourceCaseId: null,
      raw: "private",
      threads: [],
      expect: { kindOneOf: ["thread"], noActions: true, newThread: true },
    },
    calendar: { localDate: "2026-09-24", timeZone: "UTC" },
    cookie: undefined,
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return responses.shift();
    },
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    timeoutMs: 1_000,
    maxRateLimitRetries: 1,
    retryCapMs: 10,
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [0]);
  assert.equal(result.status, "pass");
  assert.equal(result.attempts, 2);
  assert.equal(result.rateLimitRetries, 1);
  assert.equal(result.via, "fixture-provider");
  assert.deepEqual(result.reasonCodes, []);
});

test("case execution classifies malformed success JSON as an output failure without throwing", async () => {
  const result = await executeCase({
    origin: "http://localhost:3000",
    testCase: {
      id: "malformed-output",
      sourceCaseId: null,
      raw: "private",
      threads: [],
      expect: { kindOneOf: ["thread"] },
    },
    calendar: { localDate: "2026-09-24", timeZone: "UTC" },
    fetchImpl: async () => Response.json(null),
    timeoutMs: 1_000,
    maxRateLimitRetries: 0,
  });

  assert.equal(result.status, "semantic_failure");
  assert.deepEqual(result.reasonCodes, ["OUTPUT_NOT_OBJECT"]);
});

test("an exhausted rate limit is quota failure even when its body is empty", async () => {
  const result = await executeCase({
    origin: "http://localhost:3000",
    testCase: {
      id: "exhausted-rate-limit",
      sourceCaseId: null,
      raw: "private",
      threads: [],
      expect: { kindOneOf: ["thread"] },
    },
    calendar: { localDate: "2026-09-24", timeZone: "UTC" },
    fetchImpl: async () => new Response("", { status: 429 }),
    timeoutMs: 1_000,
    maxRateLimitRetries: 0,
  });

  assert.equal(result.status, "quota_failure");
  assert.deepEqual(result.reasonCodes, ["QUOTA_RATE_LIMIT_EXHAUSTED"]);
});

test("artifact sanitization excludes raw input, model prose, error text, and cookies", () => {
  const privateInput = "Gleb private capture about Alice";
  const unsafe = {
    id: "private-case",
    sourceCaseId: null,
    raw: privateInput,
    output: {
      clean: privateInput,
      actions: ["Email Alice"],
      via: "provider-a",
    },
    error: "Bearer top-secret",
    cookie: "capture_session=top-secret",
    status: "semantic_failure",
    reasonCodes: ["OUTPUT_KIND_UNEXPECTED"],
    durationMs: 25,
    attempts: 1,
    rateLimitRetries: 0,
  };
  const result = sanitizeResult(unsafe);
  const artifact = buildArtifact({
    target: { origin: "http://localhost:3000", kind: "localhost" },
    build: { id: "dev", status: "ok", reasonCode: null },
    cases: [{ id: "private-case", raw: privateInput }],
    results: [unsafe],
    startedAt: "2026-09-24T00:00:00.000Z",
    finishedAt: "2026-09-24T00:00:00.025Z",
    durationMs: 25,
    rateLimitRetries: 0,
  });
  const encoded = JSON.stringify(artifact);

  assert.equal(encoded.includes(privateInput), false);
  assert.equal(encoded.includes("Email Alice"), false);
  assert.equal(encoded.includes("top-secret"), false);
  assert.equal(encoded.includes("raw"), false);
  assert.equal(encoded.includes("clean"), false);
  assert.match(result.inputSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(artifact.results, [result]);
  assert.deepEqual(result, {
    id: "private-case",
    sourceCaseId: null,
    inputSha256: result.inputSha256,
    status: "semantic_failure",
    reasonCodes: ["OUTPUT_KIND_UNEXPECTED"],
    via: "provider-a",
    observed: {
      kind: null,
      actionCount: 0,
      hasDue: false,
      threadRoute: "none",
      paragraphCount: 0,
      bulletCount: 0,
    },
    attempts: 1,
    rateLimitRetries: 0,
    durationMs: 25,
  });
  assert.equal(artifact.status, "semantic_failure");
  assert.deepEqual(artifact.totals, {
    selected: 1,
    attempted: 1,
    passed: 0,
    semanticFailures: 1,
    infrastructureFailures: 0,
    providerFailures: 0,
    quotaFailures: 0,
    rateLimitRetries: 0,
  });
});
