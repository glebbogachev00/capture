import { threadBriefs } from "../src/lib/threadBrief.ts";

const REQUIRED_COVERAGE = new Set([
  "two-existing",
  "three-existing",
  "existing-plus-new",
  "multiple-threads-plus-actions",
  "techtutor-retake-regression",
  "capture-ovid-rest-regression",
  "paraphrased-duplicate-thread",
  "paraphrased-duplicate-action",
  "relative-deadlines",
  "correction-paraphrase",
  "correction-word-nonredirect",
  "malformed-provider-fallback",
]);
const RECOVERY_REQUIRED_COVERAGE = new Set([
  "single-existing-reuse",
  "two-existing",
  "three-existing",
  "existing-plus-new",
  "unrelated-name-trap",
  "repeated-paraphrases",
  "short-capture",
  "long-multi-topic",
  "actions-mixed-with-thinking",
  "intention",
  "duplicate-destination-resistance",
]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sortedUnique = (values) => [...new Set(values)].sort();
const normalized = (value) => String(value ?? "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
const regexEscape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const termPattern = (term) => {
  const words = normalized(term).split(" ").filter(Boolean);
  if (!words.length) return null;
  const inflected = words.map((word) => {
    const escaped = regexEscape(word);
    if (word.length < 3) return escaped;
    if (/[^aeiou]y$/.test(word)) {
      return `${regexEscape(word.slice(0, -1))}(?:y|ies)`;
    }
    if (/(?:s|x|z|ch|sh)$/.test(word)) return `${escaped}(?:es)?`;
    return `${escaped}(?:s|es)?`;
  });
  return new RegExp(`\\b${inflected.join("[^a-z0-9]+")}\\b`, "i");
};
const termMatch = (text, term) => {
  const pattern = termPattern(term);
  if (!pattern) return null;
  const source = String(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const match = pattern.exec(source);
  return match ? { match, source } : null;
};
const includesTerm = (text, term) => termMatch(text, term) !== null;
const includesAffirmedTerm = (text, term) => {
  const found = termMatch(text, term);
  if (!found) return false;
  const { match, source } = found;
  const clause = source.slice(Math.max(
    source.lastIndexOf(".", match.index),
    source.lastIndexOf("!", match.index),
    source.lastIndexOf("?", match.index),
    source.lastIndexOf(";", match.index),
    source.lastIndexOf(":", match.index),
  ) + 1, match.index);
  return !/\b(?:not|no|never|without|neither|nor)\b/i.test(clause);
};
const safeVia = (value) => typeof value === "string"
  ? value.replace(/[^a-zA-Z0-9._:/-]/g, "_").slice(0, 120) || null
  : null;

function originOnly(url) {
  return url.pathname === "/" && !url.search && !url.hash;
}

export function parseTarget(args) {
  let mode = "local";
  let value = "http://localhost:3000";
  let consumedTarget = false;
  const rest = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--local" || arg === "--remote") {
      if (consumedTarget) throw new Error("Choose exactly one --local or --remote target");
      const candidate = args[++index];
      if (!candidate || candidate.startsWith("--")) throw new Error(`${arg} requires an origin`);
      mode = arg.slice(2);
      value = candidate;
      consumedTarget = true;
    } else {
      rest.push(arg);
    }
  }
  if (rest.some((arg) => /^https?:\/\//i.test(arg))) {
    throw new Error("Remote targets must be explicit with --remote");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Target must be a valid URL origin");
  }
  if (url.username || url.password) throw new Error("Target URLs cannot contain credentials");
  if (!originOnly(url)) throw new Error("Target must be an origin only (no path, query, or fragment)");

  if (mode === "local") {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error("Local target must use localhost, 127.0.0.1, or ::1");
    }
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Local target must use HTTP(S)");
  } else {
    if (url.protocol !== "https:") throw new Error("Remote target must use HTTPS");
    if (!url.hostname.endsWith(".vercel.app")) throw new Error("Remote target must be an HTTPS Vercel Preview");
    const deploymentName = url.hostname.slice(0, -".vercel.app".length);
    if ((deploymentName.match(/-/g) ?? []).length < 2) {
      throw new Error("Remote target must be an immutable Vercel Preview deployment URL");
    }
  }

  const origin = url.origin;
  return { mode, origin, sortUrl: `${origin}/api/sort`, remainingArgs: rest };
}

function validateBoard(board) {
  if (!isObject(board) || !Array.isArray(board.threads) || !Array.isArray(board.actions)
    || !Array.isArray(board.intentions) || !Array.isArray(board.ledger)) {
    throw new Error("initialBoard must be a complete synthetic in-memory board");
  }
  const ids = board.threads.map((thread) => thread?.id);
  if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) {
    throw new Error("initialBoard thread ids must be non-empty and unique");
  }
}

export function assertCasePack(
  pack,
  { requireFullCoverage = false, requireRecoveryCoverage = false } = {},
) {
  if (!isObject(pack) || typeof pack.revision !== "string" || !pack.revision) {
    throw new Error("case pack needs a revision");
  }
  validateBoard(pack.initialBoard);
  if (!Array.isArray(pack.cases) || pack.cases.length === 0) throw new Error("case pack needs cases");
  if (requireFullCoverage && pack.cases.length !== 12) {
    throw new Error("planned routing baseline must contain exactly 12 exercises");
  }
  if (requireRecoveryCoverage && (pack.mode !== "recovery" || pack.cases.length !== 11)) {
    throw new Error("owner-accepted recovery baseline must contain its exact 11 cases");
  }

  const ids = new Set();
  const availableThreads = new Set(pack.initialBoard.threads.map((thread) => thread.id));
  const coverage = new Set();
  for (const item of pack.cases) {
    if (!isObject(item) || typeof item.id !== "string" || !item.id || ids.has(item.id)) {
      throw new Error("case ids must be non-empty and unique");
    }
    ids.add(item.id);
    if (typeof item.raw !== "string" || !item.raw.trim()) throw new Error(`${item.id}: raw input is required`);
    if (!Array.isArray(item.covers)) throw new Error(`${item.id}: covers must be an array`);
    item.covers.forEach((label) => coverage.add(label));
    const expected = item.expected;
    const fixtureOnly = item.execution === "malformed-provider-fixture";
    if (!isObject(expected) || !Array.isArray(expected.destinations) ||
      expected.destinations.length === 0 && !expected.kinds?.includes("action") &&
      !expected.kinds?.includes("intention") && !fixtureOnly &&
      !(expected.kinds?.includes("pending") && expected.fallback === "pending")) {
      throw new Error(`${item.id}: expected destination set is required for thinking cases`);
    }
    if (new Set(expected.destinations).size !== expected.destinations.length) {
      throw new Error(`${item.id}: expected destinations must be unique`);
    }
    if (!Array.isArray(expected.kinds) || expected.kinds.length === 0) throw new Error(`${item.id}: expected kinds are required`);
    if (!isObject(expected.actions) || !Number.isInteger(expected.actions.min) || !Number.isInteger(expected.actions.max)
      || expected.actions.min < 0 || expected.actions.max < expected.actions.min) {
      throw new Error(`${item.id}: expected action bounds are invalid`);
    }
    if (requireFullCoverage) {
      for (const field of [
        "requiredThreadIds",
        "forbiddenThreadIds",
        "newThreads",
        "expectedActions",
        "structuredDeadlines",
        "forbiddenDuplicates",
      ]) {
        if (!Array.isArray(expected[field])) throw new Error(`${item.id}: expected.${field} must be an array`);
      }
      if (JSON.stringify(sortedUnique(expected.requiredThreadIds)) !==
        JSON.stringify(sortedUnique(expected.destinations.filter((value) => !value.startsWith("created:"))))) {
        throw new Error(`${item.id}: requiredThreadIds must name the expected existing destinations`);
      }
      const expectedActionIds = new Set();
      for (const action of expected.expectedActions) {
        if (!isObject(action) || typeof action.id !== "string" || !action.id || expectedActionIds.has(action.id)
          || !Array.isArray(action.includesAll) || action.includesAll.length === 0
          || action.includesAll.some((group) => !Array.isArray(group) || group.length === 0
            || group.some((term) => typeof term !== "string" || !term.trim()))) {
          throw new Error(`${item.id}: expected Action expectations are invalid`);
        }
        expectedActionIds.add(action.id);
      }
      for (const deadline of expected.structuredDeadlines) {
        if (!isObject(deadline) || !expectedActionIds.has(deadline.actionId)
          || !["today", "tomorrow", "next-friday"].includes(deadline.relative)) {
          throw new Error(`${item.id}: structured deadline must reference an expected Action`);
        }
      }
      if (fixtureOnly && expected.fallback !== "pending") {
        throw new Error(`${item.id}: malformed-provider fixture must expect pending fallback`);
      }
    }
    const creations = isObject(item.createdDestinations) ? item.createdDestinations : {};
    const destinationExpectations = isObject(item.destinationExpectations) ? item.destinationExpectations : {};
    for (const destination of expected.destinations) {
      const semantic = destinationExpectations[destination];
      if (!isObject(semantic)
        || !Array.isArray(semantic.shareIncludesAll) || semantic.shareIncludesAll.length === 0
        || semantic.shareIncludesAll.some((group) => !Array.isArray(group) || group.length === 0
          || group.some((term) => typeof term !== "string" || !term.trim()))
        || !Array.isArray(semantic.shareExcludes)
        || semantic.shareExcludes.some((term) => typeof term !== "string" || !term.trim())) {
        throw new Error(`${item.id}: ${destination} needs a fixed semantic destination expectation`);
      }
      if (destination.startsWith("created:")) {
        const createdId = creations[destination];
        if (typeof createdId !== "string" || !createdId || availableThreads.has(createdId)) {
          throw new Error(`${item.id}: ${destination} needs a new deterministic thread id`);
        }
        if (!Array.isArray(semantic.nameIncludesAny) || semantic.nameIncludesAny.length === 0
          || semantic.nameIncludesAny.some((term) => typeof term !== "string" || !term.trim())) {
          throw new Error(`${item.id}: ${destination} needs a fixed semantic name expectation`);
        }
      } else if (!availableThreads.has(destination)) {
        throw new Error(`${item.id}: expected destination ${destination} is unavailable at this step`);
      }
    }
    for (const [token, createdId] of Object.entries(creations)) {
      if (!expected.destinations.includes(token) || !token.startsWith("created:")) {
        throw new Error(`${item.id}: creation ${token} is not in the fixed expected set`);
      }
      availableThreads.add(createdId);
    }
    for (const token of Object.keys(destinationExpectations)) {
      if (!expected.destinations.includes(token)) {
        throw new Error(`${item.id}: semantic expectation ${token} is outside the expected destination set`);
      }
    }
  }
  if (requireFullCoverage) {
    const missing = [...REQUIRED_COVERAGE].filter((label) => !coverage.has(label));
    if (missing.length) throw new Error(`case pack is missing coverage: ${missing.join(", ")}`);
  }
  if (requireRecoveryCoverage) {
    const missing = [...RECOVERY_REQUIRED_COVERAGE].filter((label) => !coverage.has(label));
    if (missing.length) throw new Error(`recovery case pack is missing coverage: ${missing.join(", ")}`);
  }
  return true;
}

function responseDestinations(result) {
  if (!isObject(result)) return [];
  const values = [];
  if (["thread", "both"].includes(result.kind) && (result.threadId || result.threadName)) {
    values.push({ threadId: result.threadId ?? null, threadName: result.threadName ?? null, text: result.primaryText ?? result.clean ?? "" });
  }
  if (Array.isArray(result.also)) {
    for (const destination of result.also) {
      if (isObject(destination) && (destination.threadId || destination.threadName)) {
        values.push({ threadId: destination.threadId ?? null, threadName: destination.threadName ?? null, text: destination.text ?? "" });
      }
    }
  }
  return values;
}

function semanticMatches(destination, expectation) {
  const nameMatches = !expectation.nameIncludesAny
    || expectation.nameIncludesAny.some((term) => includesTerm(destination.threadName, term));
  const shareMatches = expectation.shareIncludesAll.every((group) => group.some((term) => includesAffirmedTerm(destination.text, term)))
    && expectation.shareExcludes.every((term) => !includesTerm(destination.text, term));
  return { nameMatches, shareMatches };
}

function interpretDestinations(item, result, knownThreadIds) {
  const rawDestinations = responseDestinations(result);
  const expectedCreations = item.expected.destinations.filter((value) => value.startsWith("created:"));
  const destinationExpectations = item.destinationExpectations ?? {};
  const claimed = new Set();
  const oracleReasons = [];
  let canonicalUnmatchedIndex = 0;
  const canonical = rawDestinations.map((destination) => {
    if (destination.threadId && knownThreadIds.has(destination.threadId)) {
      const expectation = destinationExpectations[destination.threadId];
      if (!expectation || !semanticMatches(destination, expectation).shareMatches) {
        oracleReasons.push("DESTINATION_SHARE_MISMATCH");
      }
      return destination.threadId;
    }
    if (destination.threadId) return `unknown:${destination.threadId}`;
    const matches = expectedCreations.map((token) => ({ token, ...semanticMatches(destination, destinationExpectations[token]) }));
    const exact = matches.filter((match) => match.nameMatches && match.shareMatches && !claimed.has(match.token));
    if (exact.length === 1) {
      claimed.add(exact[0].token);
      return exact[0].token;
    }
    if (exact.length > 1) oracleReasons.push("NEW_DESTINATION_AMBIGUOUS");
    else if (matches.some((match) => match.shareMatches && !match.nameMatches)) oracleReasons.push("NEW_DESTINATION_NAME_MISMATCH");
    else if (matches.some((match) => match.nameMatches && !match.shareMatches)) oracleReasons.push("NEW_DESTINATION_SHARE_MISMATCH");
    else oracleReasons.push("NEW_DESTINATION_SEMANTIC_MISMATCH");
    return `new:unmatched:${canonicalUnmatchedIndex++}`;
  });
  return { canonical, rawDestinations, oracleReasons };
}

function judge(item, result, interpreted, at = Date.now()) {
  const reasons = [...new Set(interpreted.oracleReasons ?? [])];
  if (!isObject(result) || typeof result.kind !== "string" || !Array.isArray(result.actions)) {
    return ["INVALID_RESPONSE"];
  }
  if (item.expected.fallback === "pending") {
    const items = result.routingPlan?.items;
    const intact = result.planned === true && Array.isArray(items) && items.length > 0
      && items.every((part) => part.unresolved === true && part.destinations?.length === 0 && !part.action)
      && items.map((part) => part.source).join("") === item.raw
      && Array.isArray(result.unresolved) && result.unresolved.join("") === item.raw
      && result.actions.length === 0 && interpreted.canonical.length === 0;
    return intact ? ["PASS"] : ["PENDING_SOURCE_MISMATCH"];
  }
  if (!item.expected.kinds.includes(result.kind)) reasons.push("KIND_MISMATCH");
  const count = result.actions.length;
  if (count < item.expected.actions.min || count > item.expected.actions.max) reasons.push("ACTION_COUNT_MISMATCH");

  const actionDetail = (index) => {
    if (!Array.isArray(result.actionDetails)) return undefined;
    const positional = result.actionDetails[index];
    if (positional?.text === result.actions[index]) return positional;
    return result.actionDetails.find((candidate) => candidate?.text === result.actions[index]);
  };
  const actionMatches = new Map();
  for (const expectation of item.expected.expectedActions ?? []) {
    const index = result.actions.findIndex((action, candidateIndex) => {
      if ([...actionMatches.values()].includes(candidateIndex)) return false;
      const detail = actionDetail(candidateIndex);
      const evidence = result.planned === true
        ? `${action}\n${typeof detail?.source === "string" ? detail.source : ""}`
        : action;
      return expectation.includesAll.every((group) =>
        group.some((term) => includesAffirmedTerm(evidence, term))
      );
    });
    if (index < 0) reasons.push("EXPECTED_ACTION_MISSING");
    else actionMatches.set(expectation.id, index);
  }

  const localDate = (offsetDays) => {
    const date = new Date(at);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + offsetDays);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const expectedRelativeDate = (relative) => {
    if (relative === "today") return localDate(0);
    if (relative === "tomorrow") return localDate(1);
    if (relative === "next-friday") {
      const day = new Date(at).getDay();
      const offset = (5 - day + 7) % 7 || 7;
      return localDate(offset);
    }
    return null;
  };
  for (const deadline of item.expected.structuredDeadlines ?? []) {
    const actionIndex = actionMatches.get(deadline.actionId);
    const detail = Number.isInteger(actionIndex) ? actionDetail(actionIndex) : undefined;
    const expectedDue = expectedRelativeDate(deadline.relative);
    if (!detail?.due || !expectedDue || !String(detail.due).startsWith(expectedDue)) {
      reasons.push("STRUCTURED_DEADLINE_MISMATCH");
    }
  }

  if ((item.expected.forbiddenThreadIds ?? []).some((id) => interpreted.canonical.includes(id))) {
    reasons.push("FORBIDDEN_DESTINATION");
  }
  for (const duplicate of item.expected.forbiddenDuplicates ?? []) {
    if (duplicate.kind === "action" && result.actions.length > 0) reasons.push("FORBIDDEN_DUPLICATE");
    if (duplicate.kind === "thread" && interpreted.canonical.some((value) => value.startsWith("created:"))) {
      reasons.push("FORBIDDEN_DUPLICATE");
    }
  }
  if (new Set(interpreted.canonical).size !== interpreted.canonical.length) reasons.push("DUPLICATE_DESTINATION");
  if ((interpreted.oracleReasons?.length ?? 0) === 0
    && JSON.stringify(sortedUnique(interpreted.canonical)) !== JSON.stringify(sortedUnique(item.expected.destinations))) {
    reasons.push("DESTINATION_SET_MISMATCH");
  }
  return reasons.length ? reasons : ["PASS"];
}

function cloneBoard(board) {
  return structuredClone(board);
}

function applySyntheticResult(board, item, result, interpreted, at) {
  const next = cloneBoard(board);
  const createdByToken = item.createdDestinations ?? {};
  for (let index = 0; index < interpreted.canonical.length; index++) {
    const canonical = interpreted.canonical[index];
    const rawDestination = interpreted.rawDestinations[index];
    let threadId = canonical;
    if (canonical.startsWith("created:")) {
      threadId = createdByToken[canonical];
      if (!next.threads.some((thread) => thread.id === threadId)) {
        next.threads.push({
          id: threadId,
          name: String(rawDestination.threadName || canonical.slice("created:".length)),
          summary: String(rawDestination.text || item.raw).slice(0, 500),
          frags: [],
        });
      }
    }
    const thread = next.threads.find((candidate) => candidate.id === threadId);
    if (thread) thread.frags.push({ id: `${item.id}:${index}`, at, text: String(rawDestination.text || item.raw) });
  }
  for (let index = 0; index < (result.actions ?? []).length; index++) {
    next.actions.push({ id: `${item.id}:action:${index}`, text: String(result.actions[index]), at });
  }
  if (result.kind === "intention") {
    next.intentions.push({ id: `${item.id}:intention`, rawInput: item.raw, at });
  }
  next.ledger.push({
    id: `${item.id}:ledger`,
    at,
    raw: item.raw,
    kind: result.kind,
    target: interpreted.canonical.join(","),
  });
  return next;
}

export function requestFor(board, item, { planned = true } = {}) {
  return {
    raw: item.raw,
    threads: threadBriefs(board.threads),
    ...(planned ? {
      captureId: `acceptance:${item.id}`,
      routingPlanVersion: 1,
      actions: board.actions
        .filter((action) => !action.done && !action.unsorted && !action.faded)
        .map((action) => ({ id: action.id, text: action.text })),
      correctionExamples: item.correctionExamples ?? [],
    } : {}),
    recent: board.ledger.slice(-20).reverse().map((entry) => ({
      raw: entry.raw,
      kind: entry.kind,
      target: entry.target,
      at: entry.at,
    })),
  };
}

export async function runSequentialBaseline({ target, casePack, fetchImpl = fetch, now = Date.now }) {
  assertCasePack(casePack);
  let board = cloneBoard(casePack.initialBoard);
  const runs = [];
  for (const item of casePack.cases) {
    const requestBody = requestFor(board, item, { planned: casePack.mode !== "recovery" });
    if (item.execution === "malformed-provider-fixture") {
      runs.push({
        id: item.id,
        inputRaw: item.raw,
        expected: cloneBoard(item.expected),
        request: {
          threads: cloneBoard(requestBody.threads),
          actions: cloneBoard(requestBody.actions),
          correctionExamples: cloneBoard(requestBody.correctionExamples),
        },
        observed: { destinations: [], shares: [], kind: null, actionsCount: null, actions: [], actionDetails: [] },
        latencyMs: 0,
        providerVia: null,
        httpStatus: null,
        reasonCodes: ["SOURCE_FIXTURE_REQUIRED"],
        pass: false,
      });
      continue;
    }
    const started = now();
    let result;
    let status = null;
    let reasonCodes;
    try {
      const response = await fetchImpl(target.sortUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      });
      status = response.status;
      if (!response.ok) {
        reasonCodes = ["HTTP_ERROR"];
      } else {
        result = await response.json();
      }
    } catch {
      reasonCodes = ["TRANSPORT_ERROR"];
    }
    const latencyMs = Math.max(0, now() - started);
    const knownThreadIds = new Set(board.threads.map((thread) => thread.id));
    const interpreted = result ? interpretDestinations(item, result, knownThreadIds) : { canonical: [], rawDestinations: [] };
    if (!reasonCodes) reasonCodes = judge(item, result, interpreted, started);
    const actionsCount = Array.isArray(result?.actions) ? result.actions.length : null;
    const run = {
      id: item.id,
      inputRaw: item.raw,
      expected: cloneBoard(item.expected),
      request: {
        threads: cloneBoard(requestBody.threads),
        actions: cloneBoard(requestBody.actions),
        correctionExamples: cloneBoard(requestBody.correctionExamples),
      },
      observed: {
        destinations: sortedUnique(interpreted.canonical),
        shares: interpreted.canonical.map((destination, index) => ({
          destination,
          text: String(interpreted.rawDestinations[index]?.text ?? ""),
        })),
        kind: typeof result?.kind === "string" ? result.kind : null,
        actionsCount,
        actions: Array.isArray(result?.actions) ? result.actions.map(String) : [],
        actionDetails: Array.isArray(result?.actionDetails)
          ? result.actionDetails.map((detail) => ({
              text: String(detail?.text ?? ""),
              due: typeof detail?.due === "string" ? detail.due : null,
              source: typeof detail?.source === "string" ? detail.source : "",
            }))
          : [],
      },
      latencyMs,
      providerVia: safeVia(result?.via),
      httpStatus: status,
      reasonCodes,
      pass: reasonCodes.length === 1 && reasonCodes[0] === "PASS",
    };
    runs.push(run);
    if (result && isObject(result)) board = applySyntheticResult(board, item, result, interpreted, now());
  }
  return { board, runs };
}

export function buildArtifact({ target, casePack, startedAt, finishedAt, runs, regressions = [] }) {
  const cases = runs.map((run) => ({
    id: run.id,
    inputRaw: run.inputRaw,
    expected: {
      destinations: [...run.expected.destinations],
      kinds: [...run.expected.kinds],
      actions: { min: run.expected.actions.min, max: run.expected.actions.max },
      requiredThreadIds: [...(run.expected.requiredThreadIds ?? [])],
      forbiddenThreadIds: [...(run.expected.forbiddenThreadIds ?? [])],
      newThreads: cloneBoard(run.expected.newThreads ?? []),
      expectedActions: cloneBoard(run.expected.expectedActions ?? []),
      structuredDeadlines: cloneBoard(run.expected.structuredDeadlines ?? []),
      forbiddenDuplicates: cloneBoard(run.expected.forbiddenDuplicates ?? []),
      ...(run.expected.fallback ? { fallback: run.expected.fallback } : {}),
    },
    request: {
      threads: cloneBoard(run.request?.threads ?? []),
      actions: cloneBoard(run.request?.actions ?? []),
      correctionExamples: cloneBoard(run.request?.correctionExamples ?? []),
    },
    observed: {
      destinations: [...run.observed.destinations],
      shares: (run.observed.shares ?? []).map((share) => ({
        destination: String(share.destination),
        text: String(share.text),
      })),
      kind: run.observed.kind,
      actionsCount: run.observed.actionsCount,
      actions: [...(run.observed.actions ?? [])],
      actionDetails: cloneBoard(run.observed.actionDetails ?? []),
    },
    latencyMs: run.latencyMs,
    providerVia: safeVia(run.providerVia),
    httpStatus: run.httpStatus ?? null,
    reasonCodes: [...run.reasonCodes],
    pass: run.pass === true,
  }));
  return {
    schemaVersion: 3,
    packRevision: casePack.revision,
    target: { mode: target.mode, origin: target.origin },
    startedAt,
    finishedAt,
    summary: {
      total: cases.length,
      passed: cases.filter((item) => item.pass).length,
      failed: cases.filter((item) => !item.pass).length,
      regressions: regressions.length,
    },
    cases,
    regressions: regressions.map((item) => ({ id: item.id, reasonCode: "BASELINE_REGRESSION" })),
  };
}

export function detectBaselineRegressions(baseline, candidate) {
  const currentById = new Map((candidate?.cases ?? []).map((item) => [item.id, item]));
  const regressions = [];
  for (const prior of baseline?.cases ?? []) {
    if (!prior.pass) continue;
    const current = currentById.get(prior.id);
    const sameObserved = current && JSON.stringify(current.observed) === JSON.stringify(prior.observed);
    if (!current?.pass || !sameObserved) regressions.push({ id: prior.id, reasonCode: "BASELINE_REGRESSION" });
  }
  return regressions;
}
