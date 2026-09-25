import { threadBriefs } from "../src/lib/threadBrief.ts";

const REQUIRED_COVERAGE = new Set([
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
const includesTerm = (text, term) => normalized(text).includes(normalized(term));
const regexEscape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const includesAffirmedTerm = (text, term) => {
  const source = String(text ?? "").toLowerCase();
  const words = normalized(term).split(" ").filter(Boolean);
  if (!words.length) return false;
  const phrase = words.map(regexEscape).join("[^a-z0-9]+");
  const match = new RegExp(`\\b${phrase}\\b`, "i").exec(source);
  if (!match) return false;
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

export function assertCasePack(pack, { requireFullCoverage = false } = {}) {
  if (!isObject(pack) || typeof pack.revision !== "string" || !pack.revision) {
    throw new Error("case pack needs a revision");
  }
  validateBoard(pack.initialBoard);
  if (!Array.isArray(pack.cases) || pack.cases.length === 0) throw new Error("case pack needs cases");
  if (requireFullCoverage && (pack.cases.length < 10 || pack.cases.length > 12)) {
    throw new Error("routing baseline must contain 10–12 cases");
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
    if (!isObject(expected) || !Array.isArray(expected.destinations) || expected.destinations.length === 0 && !expected.kinds?.includes("action") && !expected.kinds?.includes("intention")) {
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

function judge(item, result, interpreted) {
  const reasons = [...new Set(interpreted.oracleReasons ?? [])];
  if (!isObject(result) || typeof result.kind !== "string" || !Array.isArray(result.actions)) {
    return ["INVALID_RESPONSE"];
  }
  if (!item.expected.kinds.includes(result.kind)) reasons.push("KIND_MISMATCH");
  const count = result.actions.length;
  if (count < item.expected.actions.min || count > item.expected.actions.max) reasons.push("ACTION_COUNT_MISMATCH");
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

export function requestFor(board, item) {
  return {
    raw: item.raw,
    threads: threadBriefs(board.threads),
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
    const requestBody = requestFor(board, item);
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
    if (!reasonCodes) reasonCodes = judge(item, result, interpreted);
    const actionsCount = Array.isArray(result?.actions) ? result.actions.length : null;
    const run = {
      id: item.id,
      inputRaw: item.raw,
      expected: cloneBoard(item.expected),
      observed: {
        destinations: sortedUnique(interpreted.canonical),
        shares: interpreted.canonical.map((destination, index) => ({
          destination,
          text: String(interpreted.rawDestinations[index]?.text ?? ""),
        })),
        kind: typeof result?.kind === "string" ? result.kind : null,
        actionsCount,
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
    },
    observed: {
      destinations: [...run.observed.destinations],
      shares: (run.observed.shares ?? []).map((share) => ({
        destination: String(share.destination),
        text: String(share.text),
      })),
      kind: run.observed.kind,
      actionsCount: run.observed.actionsCount,
    },
    latencyMs: run.latencyMs,
    providerVia: safeVia(run.providerVia),
    httpStatus: run.httpStatus ?? null,
    reasonCodes: [...run.reasonCodes],
    pass: run.pass === true,
  }));
  return {
    schemaVersion: 2,
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
