import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertCasePack,
  buildArtifact,
  detectBaselineRegressions,
  fromSimpleSort,
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

test("the checked-in planned oracle is fixed, synthetic, sequential, and complete", async () => {
  const pack = JSON.parse(await readFile(new URL("./routing-baseline-cases.json", import.meta.url), "utf8"));
  assert.equal(pack.cases.length, 12);
  assert.equal(pack.initialBoard.threads.length, 31);
  assert.doesNotThrow(() => assertCasePack(pack, { requireFullCoverage: true }));
  assert.deepEqual(pack.cases.find((item) => item.id === "two-existing-techtutor-retake").expected.requiredThreadIds,
    ["thread-techtutor", "thread-retake"]);
  assert.deepEqual(pack.cases.find((item) => item.id === "three-existing-capture-ovid-rest").expected.requiredThreadIds,
    ["thread-capture", "thread-ovid", "thread-rest-day"]);
  for (const item of pack.cases) {
    assert.ok(Array.isArray(item.expected.requiredThreadIds));
    assert.ok(Array.isArray(item.expected.forbiddenThreadIds));
    assert.ok(Array.isArray(item.expected.newThreads));
    assert.ok(Array.isArray(item.expected.expectedActions));
    assert.ok(Array.isArray(item.expected.structuredDeadlines));
    assert.ok(Array.isArray(item.expected.forbiddenDuplicates));
  }
  assert.equal(pack.cases.at(-1).execution, "malformed-provider-fixture");
  assert.equal(pack.cases.at(-1).expected.fallback, "pending");
  assert.equal(JSON.stringify(pack).includes("/Users/"), false);
});

test("the owner-accepted R1 recovery matrix remains mandatory beside planned routing", async () => {
  const pack = JSON.parse(await readFile(new URL("./routing-recovery-cases.json", import.meta.url), "utf8"));
  assert.equal(pack.revision, "r1-owner-accepted-recovery-v2");
  assert.equal(pack.mode, "recovery");
  assert.equal(pack.cases.length, 11);
  assert.deepEqual(pack.cases.map((item) => item.id), [
    "single-existing-techtutor",
    "two-existing-techtutor-retake",
    "three-existing-capture-ovid-rest",
    "existing-capture-plus-new-garden",
    "unrelated-atlas-name-trap",
    "garden-paraphrase-reuse",
    "short-retake-reuse",
    "long-multi-topic-existing",
    "capture-thinking-with-actions",
    "clear-intention",
    "garden-duplicate-resistance",
  ]);
  assert.doesNotThrow(() => assertCasePack(pack, { requireRecoveryCoverage: true }));
});

test("the full pack rejects deadlines without a declared Action expectation", async () => {
  const pack = JSON.parse(await readFile(new URL("./routing-baseline-cases.json", import.meta.url), "utf8"));
  const changed = structuredClone(pack);
  changed.cases[8].expected.structuredDeadlines[0].actionId = "missing-action";
  assert.throws(
    () => assertCasePack(changed, { requireFullCoverage: true }),
    /structured deadline/i,
  );
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

test("recovery requests keep the accepted legacy route while default requests use the one-call sorter", () => {
  const item = cases[0];
  const recovery = requestFor(seedBoard(), item, { planned: false });
  assert.equal("sortVersion" in recovery, false);
  assert.equal("captureId" in recovery, false);
  assert.equal("actions" in recovery, false);
  const planned = requestFor(seedBoard(), item);
  assert.equal(planned.sortVersion, 2);
  assert.equal("routingPlanVersion" in planned, false);
  assert.equal(planned.captureId, "acceptance:reuse-alpha");
});

test("the one-call sorter's items read as the judged single-call shape", () => {
  const legacy = fromSimpleSort({ via: "groq", sort: { version: 2, items: [
    { kind: "thought", text: "Bread needs a colder proof.", threads: [{ id: "thread-bread" }] },
    { kind: "thought", text: "Meteor marks need cloud cover.", threads: [{ name: "Meteor log" }] },
    { kind: "action", text: "Export chart", due: "2026-10-02" },
    { kind: "action", text: "Make demos", existingActionId: "open-1" },
  ] } });
  assert.deepEqual(legacy, {
    via: "groq",
    kind: "both",
    actions: ["Export chart"],
    actionDetails: [{ text: "Export chart", due: "2026-10-02", source: "" }],
    threadId: "thread-bread",
    threadName: null,
    primaryText: "Bread needs a colder proof.",
    clean: "Bread needs a colder proof.\n\nMeteor marks need cloud cover.",
    also: [{ threadId: null, threadName: "Meteor log", text: "Meteor marks need cloud cover." }],
  });
  assert.equal(fromSimpleSort({ sort: { items: [{ kind: "intention", text: "I rest." }] } }).kind, "intention");
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

test("semantic term matching accepts ordinary plurals without matching lexical neighbors", async () => {
  const pluralItem = {
    id: "plural-subject",
    covers: [],
    raw: "Lanterns guide the winter walks.",
    expected: { destinations: ["thread-alpha"], kinds: ["thread"], actions: { min: 0, max: 0 } },
    destinationExpectations: {
      "thread-alpha": { shareIncludesAll: [["lantern"]], shareExcludes: ["article"] },
    },
  };
  const plural = await runSequentialBaseline({
    target: parseTarget([]),
    casePack: { revision: "plural-regression", initialBoard: seedBoard(), cases: [pluralItem] },
    fetchImpl: async () => response({
      kind: "thread",
      actions: [],
      threadId: "thread-alpha",
      threadName: null,
      primaryText: "Lanterns guide the winter walks.",
      also: [],
    }),
  });
  assert.deepEqual(plural.runs[0].reasonCodes, ["PASS"]);

  const neighborItem = {
    ...pluralItem,
    id: "lexical-neighbor",
    raw: "An article describes archival methods.",
    destinationExpectations: {
      "thread-alpha": { shareIncludesAll: [["article"]], shareExcludes: ["art"] },
    },
  };
  const neighbor = await runSequentialBaseline({
    target: parseTarget([]),
    casePack: { revision: "neighbor-regression", initialBoard: seedBoard(), cases: [neighborItem] },
    fetchImpl: async () => response({
      kind: "thread",
      actions: [],
      threadId: "thread-alpha",
      threadName: null,
      primaryText: "An article describes archival methods.",
      also: [],
    }),
  });
  assert.deepEqual(neighbor.runs[0].reasonCodes, ["PASS"]);
});

test("the exact existing-plus-new fixture oracle accepts owned shares and rejects boundary bleed", async () => {
  const pack = JSON.parse(await readFile(new URL("./routing-baseline-cases.json", import.meta.url), "utf8"));
  const item = pack.cases.find((candidate) => candidate.id === "existing-capture-plus-new-garden");
  assert.ok(item);
  const fixturePack = { revision: "existing-plus-new-regression", initialBoard: pack.initialBoard, cases: [item] };
  const correct = await runSequentialBaseline({
    target: parseTarget([]),
    casePack: fixturePack,
    fetchImpl: async () => response({
      kind: "thread",
      actions: [],
      threadId: "thread-capture",
      threadName: null,
      primaryText: "Capture search should keep local matches visible while it finds a supported answer.",
      also: [{
        text: "A separate idea to develop is a small rooftop pollinator garden with wind-tolerant herbs and native flowers in lightweight planters.",
        threadId: null,
        threadName: "Rooftop pollinator garden",
      }],
    }),
  });
  assert.deepEqual(correct.runs[0].reasonCodes, ["PASS"]);

  const bleeding = await runSequentialBaseline({
    target: parseTarget([]),
    casePack: fixturePack,
    fetchImpl: async () => response({
      kind: "thread",
      actions: [],
      threadId: "thread-capture",
      threadName: null,
      primaryText: "Capture search should keep local matches visible while it finds a supported answer.",
      also: [{
        text: "Capture search should keep local matches visible. A separate rooftop pollinator garden.",
        threadId: null,
        threadName: "Rooftop pollinator garden",
      }],
    }),
  });
  assert.deepEqual(bleeding.runs[0].reasonCodes, ["NEW_DESTINATION_SHARE_MISMATCH"]);
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

test("oracle enforces expected Action meaning and per-Action structured deadlines", async () => {
  const item = {
    id: "dated-action",
    covers: [],
    raw: "Send the synthetic note tomorrow.",
    expected: {
      destinations: [],
      kinds: ["action"],
      actions: { min: 1, max: 1 },
      requiredThreadIds: [], forbiddenThreadIds: [], newThreads: [], forbiddenDuplicates: [],
      expectedActions: [{ id: "send-note", includesAll: [["send"], ["synthetic", "note"], ["tomorrow"]] }],
      structuredDeadlines: [{ actionId: "send-note", relative: "tomorrow" }],
    },
    destinationExpectations: {},
  };
  const fixedNow = new Date("2026-09-26T12:00:00Z").getTime();
  const run = async (body) => runSequentialBaseline({
    target: parseTarget([]),
    casePack: { revision: "test", initialBoard: seedBoard(), cases: [item] },
    fetchImpl: async () => response(body),
    now: () => fixedNow,
  });

  const wrongMeaning = await run({
    kind: "action",
    actions: ["Inspect the synthetic note tomorrow"],
    actionDetails: [{
      text: "Inspect the synthetic note tomorrow",
      due: "2026-09-27",
      source: "Send the synthetic note tomorrow.",
    }],
  });
  assert.deepEqual(wrongMeaning.runs[0].reasonCodes.sort(), ["EXPECTED_ACTION_MISSING", "STRUCTURED_DEADLINE_MISMATCH"]);

  const wrongDue = await run({
    kind: "action", actions: ["Send the synthetic note tomorrow"], actionDetails: [{ text: "Send the synthetic note tomorrow", due: "2026-09-28" }],
  });
  assert.deepEqual(wrongDue.runs[0].reasonCodes, ["STRUCTURED_DEADLINE_MISMATCH"]);

  const valid = await run({
    kind: "action", actions: ["Send the synthetic note tomorrow"], actionDetails: [{ text: "Send the synthetic note tomorrow", due: "2026-09-27" }],
  });
  assert.equal(valid.runs[0].pass, true);
});

test("planned oracle judges owned Action source, deadlines, and Thread shares independently", async () => {
  const item = {
    id: "bread-and-meteors",
    covers: [],
    raw: "The bread notebook should compare cold-proof aroma. The meteor log needs clearer cloud-cover marks. Photograph the next sourdough loaf tomorrow. Export the meteor chart next Friday.",
    expected: {
      destinations: ["thread-bread", "thread-meteors"],
      kinds: ["both"],
      actions: { min: 1, max: 2 },
      requiredThreadIds: ["thread-bread", "thread-meteors"],
      forbiddenThreadIds: [], newThreads: [], forbiddenDuplicates: [],
      expectedActions: [
        { id: "photo-loaf", includesAll: [["photograph"], ["sourdough"], ["loaf"]] },
        { id: "export-chart", includesAll: [["export"], ["meteor"], ["chart"]] },
      ],
      structuredDeadlines: [
        { actionId: "photo-loaf", relative: "tomorrow" },
        { actionId: "export-chart", relative: "next-friday" },
      ],
    },
    destinationExpectations: {
      "thread-bread": {
        shareIncludesAll: [["bread"], ["cold-proof", "aroma"]],
        shareExcludes: ["meteor", "photograph", "tomorrow"],
      },
      "thread-meteors": {
        shareIncludesAll: [["meteor"], ["cloud-cover", "marks"]],
        shareExcludes: ["bread", "export", "friday"],
      },
    },
  };
  const board = {
    ...seedBoard(),
    threads: [
      { id: "thread-bread", name: "Bread notebook", summary: "Bread fermentation experiments.", frags: [] },
      { id: "thread-meteors", name: "Meteor log", summary: "Meteor observation design.", frags: [] },
    ],
  };
  const fixedNow = new Date("2026-09-26T12:00:00Z").getTime();
  const base = {
    planned: true,
    kind: "both",
    actions: ["Photograph loaf", "Export chart"],
    actionDetails: [
      {
        text: "Photograph loaf",
        due: "2026-09-27",
        source: "Photograph the next sourdough loaf tomorrow. ",
      },
      {
        text: "Export chart",
        due: "2026-10-02",
        source: "Export the meteor chart next Friday.",
      },
    ],
    threadId: "thread-bread",
    threadName: null,
    primaryText: "The bread notebook should compare cold-proof aroma.",
    also: [{
      text: "The meteor log needs clearer cloud-cover marks.",
      threadId: "thread-meteors",
      threadName: null,
    }],
  };
  const run = async (body) => runSequentialBaseline({
    target: parseTarget([]),
    casePack: { revision: "planned-owned-source", initialBoard: board, cases: [item] },
    fetchImpl: async () => response(body),
    now: () => fixedNow,
  });

  const valid = await run(base);
  assert.deepEqual(valid.runs[0].reasonCodes, ["PASS"]);

  const missingAction = await run({
    ...base,
    actions: base.actions.slice(0, 1),
    actionDetails: base.actionDetails.slice(0, 1),
    also: [{
      ...base.also[0],
      text: `${base.also[0].text} Export the meteor chart next Friday.`,
    }],
  });
  assert.ok(missingAction.runs[0].reasonCodes.includes("EXPECTED_ACTION_MISSING"));
  assert.ok(missingAction.runs[0].reasonCodes.includes("STRUCTURED_DEADLINE_MISMATCH"));
  assert.ok(missingAction.runs[0].reasonCodes.includes("DESTINATION_SHARE_MISMATCH"));

  const missingDeadline = await run({
    ...base,
    actionDetails: base.actionDetails.map((detail, index) =>
      index === 0 ? { ...detail, due: null } : detail
    ),
  });
  assert.deepEqual(missingDeadline.runs[0].reasonCodes, ["STRUCTURED_DEADLINE_MISMATCH"]);

  const topicLeak = await run({
    ...base,
    primaryText: `${base.primaryText} ${base.also[0].text}`,
  });
  assert.deepEqual(topicLeak.runs[0].reasonCodes, ["DESTINATION_SHARE_MISMATCH"]);
});

test("fixture-only malformed response case cannot be mistaken for a live semantic pass", async () => {
  let calls = 0;
  const item = {
    id: "malformed",
    covers: [],
    execution: "malformed-provider-fixture",
    raw: "Synthetic malformed input.",
    expected: { destinations: [], kinds: ["pending"], actions: { min: 0, max: 0 } },
    destinationExpectations: {},
  };
  const result = await runSequentialBaseline({
    target: parseTarget([]),
    casePack: { revision: "test", initialBoard: seedBoard(), cases: [item] },
    fetchImpl: async () => { calls++; return response({}); },
  });
  assert.equal(calls, 0);
  assert.equal(result.runs[0].pass, false);
  assert.deepEqual(result.runs[0].reasonCodes, ["SOURCE_FIXTURE_REQUIRED"]);
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
  assert.equal(artifact.schemaVersion, 3);
});

test("baseline comparison detects a previously passing case regression", () => {
  const baseline = { cases: [{ id: "reuse-alpha", pass: true, observed: { destinations: ["thread-alpha"], kind: "thread", actionsCount: 0 } }] };
  const same = { cases: [{ id: "reuse-alpha", pass: true, observed: { destinations: ["thread-alpha"], kind: "thread", actionsCount: 0 } }] };
  const regressed = { cases: [{ id: "reuse-alpha", pass: false, observed: { destinations: ["created:wrong"], kind: "thread", actionsCount: 0 } }] };
  assert.deepEqual(detectBaselineRegressions(baseline, same), []);
  assert.deepEqual(detectBaselineRegressions(baseline, regressed), [{ id: "reuse-alpha", reasonCode: "BASELINE_REGRESSION" }]);
});
