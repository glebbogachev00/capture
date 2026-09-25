import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertCasePack,
  buildArtifact,
  detectBaselineRegressions,
  parseTarget,
  requestFor,
  runSequentialBaseline,
} from "./routing-baseline-lib.mjs";
import { threadBriefs } from "../src/lib/threadBrief.ts";

const seedBoard = () => ({
  threads: [{ id: "thread-alpha", name: "Alpha", summary: "Alpha work", frags: [] }],
  actions: [],
  intentions: [],
  ledger: [],
});

const cases = [
  {
    id: "reuse-alpha",
    covers: ["single-existing-reuse"],
    raw: "A synthetic note for Alpha.",
    expected: { destinations: ["thread-alpha"], kinds: ["thread"], actions: { min: 0, max: 0 } },
    destinationExpectations: {
      "thread-alpha": { shareIncludesAll: [["alpha"]], shareExcludes: ["beta"] },
    },
  },
  {
    id: "create-beta",
    covers: ["existing-plus-new"],
    raw: "A synthetic note for Alpha and a new Beta subject.",
    expected: { destinations: ["thread-alpha", "created:beta"], kinds: ["thread"], actions: { min: 0, max: 0 } },
    createdDestinations: { "created:beta": "thread-created-beta" },
    destinationExpectations: {
      "thread-alpha": {
        shareIncludesAll: [["alpha"]],
        shareExcludes: ["beta"],
      },
      "created:beta": {
        nameIncludesAny: ["beta"],
        shareIncludesAll: [["beta"]],
        shareExcludes: ["alpha"],
      },
    },
  },
  {
    id: "reuse-beta",
    covers: ["repeated-paraphrases"],
    raw: "Another synthetic phrasing for Beta.",
    expected: { destinations: ["thread-created-beta"], kinds: ["thread"], actions: { min: 0, max: 0 } },
    destinationExpectations: {
      "thread-created-beta": { shareIncludesAll: [["beta"]], shareExcludes: ["alpha"] },
    },
  },
];

function response(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("the checked-in oracle is fixed, synthetic, sequential, and covers the R1 matrix", async () => {
  const pack = JSON.parse(await readFile(new URL("./routing-baseline-cases.json", import.meta.url), "utf8"));
  assert.equal(pack.cases.length, 11);
  assert.equal(pack.initialBoard.threads.length, 31);
  assert.doesNotThrow(() => assertCasePack(pack, { requireFullCoverage: true }));
  assert.deepEqual(pack.cases.find((item) => item.id === "two-existing-techtutor-retake").expected.destinations,
    ["thread-techtutor", "thread-retake"]);
  assert.deepEqual(pack.cases.find((item) => item.id === "three-existing-capture-ovid-rest").expected.destinations,
    ["thread-capture", "thread-ovid", "thread-rest-day"]);
  assert.equal(JSON.stringify(pack).includes("/Users/"), false);
});

test("request context exactly reuses production thread briefs at 31 threads", () => {
  const threads = Array.from({ length: 31 }, (_, index) => ({
    id: `thread-synthetic-${index + 1}`,
    name: `Synthetic subject ${index + 1}`,
    belongs: `Synthetic boundary ${index + 1}; not neighboring synthetic subjects.`,
    summary: `${`Synthetic detail ${index + 1}. `.repeat(30)}End.`,
    frags: [{ id: `frag-${index + 1}`, at: 1_760_000_100_000 + index, text: "Recent text must not bypass the production transport contract." }],
  }));
  const board = { ...seedBoard(), threads };
  assert.deepEqual(requestFor(board, cases[0]).threads, threadBriefs(threads));
});

test("a semantically wrong new destination cannot satisfy a created token positionally", async () => {
  const result = await runSequentialBaseline({
    target: parseTarget([]),
    casePack: { revision: "test", initialBoard: seedBoard(), cases: [cases[1]] },
    fetchImpl: async () => response({
      kind: "thread",
      actions: [],
      threadId: "thread-alpha",
      threadName: null,
      primaryText: "Alpha part",
      also: [{ text: "Beta research notes", threadId: null, threadName: "Unrelated Gamma archive" }],
    }),
  });
  assert.deepEqual(result.runs[0].reasonCodes, ["NEW_DESTINATION_NAME_MISMATCH"]);
});

test("a wrong new share cannot satisfy a plausible new Thread name", async () => {
  const result = await runSequentialBaseline({
    target: parseTarget([]),
    casePack: { revision: "test", initialBoard: seedBoard(), cases: [cases[1]] },
    fetchImpl: async () => response({
      kind: "thread",
      actions: [],
      threadId: "thread-alpha",
      threadName: null,
      primaryText: "Alpha part",
      also: [{ text: "Alpha research notes", threadId: null, threadName: "Beta Lab" }],
    }),
  });
  assert.deepEqual(result.runs[0].reasonCodes, ["NEW_DESTINATION_SHARE_MISMATCH"]);
});

test("swapped shares between correct existing Thread ids fail", async () => {
  const twoThreads = {
    ...seedBoard(),
    threads: [
      { id: "thread-alpha", name: "Alpha", summary: "Alpha work", frags: [] },
      { id: "thread-beta", name: "Beta", summary: "Beta work", frags: [] },
    ],
  };
  const item = {
    id: "alpha-beta",
    covers: [],
    raw: "Alpha research. Separately, Beta research.",
    expected: { destinations: ["thread-alpha", "thread-beta"], kinds: ["thread"], actions: { min: 0, max: 0 } },
    destinationExpectations: {
      "thread-alpha": { shareIncludesAll: [["alpha"]], shareExcludes: ["beta"] },
      "thread-beta": { shareIncludesAll: [["beta"]], shareExcludes: ["alpha"] },
    },
  };
  const result = await runSequentialBaseline({
    target: parseTarget([]),
    casePack: { revision: "test", initialBoard: twoThreads, cases: [item] },
    fetchImpl: async () => response({
      kind: "thread",
      actions: [],
      threadId: "thread-alpha",
      threadName: null,
      primaryText: "Beta research.",
      also: [{ text: "Alpha research.", threadId: "thread-beta", threadName: null }],
    }),
  });
  assert.deepEqual(result.runs[0].reasonCodes, ["DESTINATION_SHARE_MISMATCH"]);
});

test("a negated required subject does not satisfy the semantic oracle", async () => {
  const result = await runSequentialBaseline({
    target: parseTarget([]),
    casePack: { revision: "test", initialBoard: seedBoard(), cases: [cases[1]] },
    fetchImpl: async () => response({
      kind: "thread",
      actions: [],
      threadId: "thread-alpha",
      threadName: null,
      primaryText: "Alpha part",
      also: [{ text: "This is not a Beta subject.", threadId: null, threadName: "Beta Lab" }],
    }),
  });
  assert.deepEqual(result.runs[0].reasonCodes, ["NEW_DESTINATION_SHARE_MISMATCH"]);
});

test("missing and extra new destinations fail the exact-set oracle", async () => {
  const missing = await runSequentialBaseline({
    target: parseTarget([]),
    casePack: { revision: "test", initialBoard: seedBoard(), cases: [cases[1]] },
    fetchImpl: async () => response({
      kind: "thread", actions: [], threadId: "thread-alpha", threadName: null,
      primaryText: "Alpha part", also: [],
    }),
  });
  assert.deepEqual(missing.runs[0].reasonCodes, ["DESTINATION_SET_MISMATCH"]);

  const extra = await runSequentialBaseline({
    target: parseTarget([]),
    casePack: { revision: "test", initialBoard: seedBoard(), cases: [cases[1]] },
    fetchImpl: async () => response({
      kind: "thread", actions: [], threadId: "thread-alpha", threadName: null,
      primaryText: "Alpha part",
      also: [
        { text: "Beta research notes", threadId: null, threadName: "Beta Lab" },
        { text: "Gamma research notes", threadId: null, threadName: "Gamma Lab" },
      ],
    }),
  });
  assert.deepEqual(extra.runs[0].reasonCodes, ["NEW_DESTINATION_SEMANTIC_MISMATCH"]);
});

test("a relevant candidate in position 31 remains routable with its production boundary", async () => {
  const distractors = Array.from({ length: 30 }, (_, index) => ({
    id: `thread-distractor-${index + 1}`,
    name: `Synthetic distractor ${index + 1}`,
    belongs: `Only synthetic distractor topic ${index + 1}.`,
    summary: `Synthetic distractor material ${index + 1}.`,
    frags: [],
  }));
  const late = {
    id: "thread-alpha",
    name: "Alpha",
    belongs: "Alpha research and experiments; not synthetic distractor topics.",
    summary: "Alpha work.",
    frags: [],
  };
  const requests = [];
  const result = await runSequentialBaseline({
    target: parseTarget([]),
    casePack: { revision: "test", initialBoard: { ...seedBoard(), threads: [...distractors, late] }, cases: [cases[0]] },
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return response({ kind: "thread", actions: [], threadId: "thread-alpha", threadName: null, primaryText: "A synthetic note for Alpha.", also: [] });
    },
  });
  assert.equal(requests[0].threads.length, 31);
  assert.deepEqual(requests[0].threads[30], threadBriefs([...distractors, late])[30]);
  assert.equal(result.runs[0].pass, true);
});

test("URL safety defaults to localhost and rejects unsafe or implicit remote targets", () => {
  assert.equal(parseTarget([]).sortUrl, "http://localhost:3000/api/sort");
  assert.equal(parseTarget(["--local", "http://127.0.0.1:4998"]).sortUrl, "http://127.0.0.1:4998/api/sort");
  assert.throws(() => parseTarget(["https://capture-abc-team.vercel.app"]), /--remote/);
  assert.throws(() => parseTarget(["--local", "https://example.com"]), /localhost/);
  assert.throws(() => parseTarget(["--remote", "http://capture-abc-team.vercel.app"]), /HTTPS/);
  assert.throws(() => parseTarget(["--remote", "https://trycapture.app"]), /Vercel Preview/);
  assert.throws(() => parseTarget(["--remote", "https://capture-khaki.vercel.app"]), /deployment URL/);
  assert.throws(() => parseTarget(["--remote", "https://user:secret@capture-abc-team.vercel.app"]), /credentials/);
  assert.throws(() => parseTarget(["--remote", "https://capture-abc-team.vercel.app/path"]), /origin only/);
  assert.equal(
    parseTarget(["--remote", "https://capture-routing-a1b2c3-synthetic.vercel.app"]).sortUrl,
    "https://capture-routing-a1b2c3-synthetic.vercel.app/api/sort",
  );
});

test("sequential execution accumulates only the synthetic in-memory board", async () => {
  const requests = [];
  const outputs = [
    { kind: "thread", actions: [], threadId: "thread-alpha", threadName: null, primaryText: "A synthetic note for Alpha.", also: [], via: "fixture" },
    { kind: "thread", actions: [], threadId: "thread-alpha", threadName: null, primaryText: "Alpha part", also: [{ text: "Beta part", threadId: null, threadName: "Beta Lab" }], via: "fixture" },
    { kind: "thread", actions: [], threadId: "thread-created-beta", threadName: null, primaryText: "Another synthetic phrasing for Beta.", also: [], via: "fixture" },
  ];
  const fetchImpl = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return response(outputs.shift());
  };

  const result = await runSequentialBaseline({
    target: parseTarget([]),
    casePack: { revision: "test", initialBoard: seedBoard(), cases },
    fetchImpl,
    now: (() => { let value = 1000; return () => ++value; })(),
  });

  assert.equal(requests.length, 3);
  assert.equal(requests[0].raw, cases[0].raw);
  assert.equal(requests[1].threads.some((thread) => thread.id === "thread-created-beta"), false);
  assert.equal(requests[2].threads.some((thread) => thread.id === "thread-created-beta"), true);
  assert.equal(result.board.threads.some((thread) => thread.id === "thread-created-beta"), true);
  assert.deepEqual(result.runs.map((run) => run.observed.destinations), [
    ["thread-alpha"],
    ["created:beta", "thread-alpha"],
    ["thread-created-beta"],
  ]);
  assert.deepEqual(result.board.ledger.map((entry) => entry.raw), cases.map((item) => item.raw));
});

test("oracle compares exact destination sets, kinds, action counts, and duplicates", async () => {
  assert.doesNotThrow(() => assertCasePack({ revision: "test", initialBoard: seedBoard(), cases }));
  assert.throws(
    () => assertCasePack({ revision: "test", initialBoard: seedBoard(), cases: [{ ...cases[0], expected: { ...cases[0].expected, destinations: [] } }] }),
    /destination/,
  );
  const result = await runSequentialBaseline({
    target: parseTarget([]),
    casePack: { revision: "test", initialBoard: seedBoard(), cases: [cases[0]] },
    fetchImpl: async () => response({
      kind: "both",
      actions: ["Synthetic action"],
      threadId: "thread-alpha",
      threadName: null,
      primaryText: "Alpha part",
      also: [{ text: "Duplicate Alpha part", threadId: "thread-alpha", threadName: null }],
      via: "fixture",
    }),
  });
  assert.deepEqual(result.runs[0].reasonCodes.sort(), [
    "ACTION_COUNT_MISMATCH",
    "DUPLICATE_DESTINATION",
    "KIND_MISMATCH",
  ]);
});

test("artifact sanitizer preserves fixed raw inputs but excludes response prose and errors", () => {
  const artifact = buildArtifact({
    target: parseTarget([]),
    casePack: { revision: "test", initialBoard: seedBoard(), cases },
    startedAt: "2026-09-25T00:00:00.000Z",
    finishedAt: "2026-09-25T00:00:01.000Z",
    runs: [{
      id: cases[0].id,
      inputRaw: cases[0].raw,
      expected: cases[0].expected,
      observed: {
        destinations: ["thread-alpha"],
        shares: [{ destination: "thread-alpha", text: "A synthetic note for Alpha." }],
        kind: "thread",
        actionsCount: 0,
      },
      latencyMs: 12,
      providerVia: "fixture-provider",
      reasonCodes: ["PASS"],
      pass: true,
      responseText: "PRIVATE_RESPONSE_SHOULD_NOT_SURVIVE",
      error: "SECRET_ERROR_SHOULD_NOT_SURVIVE",
    }],
  });
  const serialized = JSON.stringify(artifact);
  assert.equal(artifact.cases[0].inputRaw, cases[0].raw);
  assert.match(serialized, /fixture-provider/);
  assert.doesNotMatch(serialized, /PRIVATE_RESPONSE|SECRET_ERROR/);
  assert.equal(artifact.cases[0].observed.shares[0].text, "A synthetic note for Alpha.");
  assert.equal(artifact.schemaVersion, 2);
});

test("baseline comparison detects a previously passing case regression", () => {
  const baseline = { cases: [{ id: "reuse-alpha", pass: true, observed: { destinations: ["thread-alpha"], kind: "thread", actionsCount: 0 } }] };
  const same = { cases: [{ id: "reuse-alpha", pass: true, observed: { destinations: ["thread-alpha"], kind: "thread", actionsCount: 0 } }] };
  const regressed = { cases: [{ id: "reuse-alpha", pass: false, observed: { destinations: ["created:wrong"], kind: "thread", actionsCount: 0 } }] };
  assert.deepEqual(detectBaselineRegressions(baseline, same), []);
  assert.deepEqual(detectBaselineRegressions(baseline, regressed), [{ id: "reuse-alpha", reasonCode: "BASELINE_REGRESSION" }]);
});
