import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";

const directActions = [
  "Fix the signup error after an invite is accepted",
  "Test the pricing experiment comparing usage-based billing with seats",
  "Profile the render path before adding another dashboard",
  "Document onboarding for a new developer",
];

function response(actions) {
  return {
    kind: "both",
    clean: "Synthetic hard capture",
    actions,
    actionMeta: actions.map((action) => ({ source: action, shelfLife: "days" })),
    threadId: null,
    threadName: "Release assistant",
    via: "synthetic",
  };
}

async function runShootout(actions) {
  const directory = await mkdtemp(join(os.tmpdir(), "capture-sort-shootout-"));
  const artifact = join(directory, "artifact.json");
  const server = http.createServer((request, result) => {
    request.resume();
    result.writeHead(200, { "Content-Type": "application/json" });
    result.end(JSON.stringify(response(actions)));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const args = [
    "scripts/semantic-sort-shootout.mjs",
    "--base", `http://127.0.0.1:${address.port}`,
    "--provider", "synthetic",
    "--model", "synthetic/model",
    "--repetitions", "1",
    "--artifact", artifact,
  ];
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === null
      ? reject(new Error("shootout child exited without a code"))
      : resolve({ code, stderr }));
  });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  try {
    return {
      ...exitCode,
      artifact: JSON.parse(await readFile(artifact, "utf8")),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("shootout accepts clean standalone imperative Actions", async () => {
  const result = await runShootout(directActions);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.artifact.runs[0].output.actionTextQuality.pass, true);
  assert.equal(result.artifact.verdict, "pass");
});

test("shootout rejects copied conjunction/filler Action fragments without rewriting them", async () => {
  const copiedFragment = "and I should fix the signup error after an invite is accepted";
  const result = await runShootout([copiedFragment, ...directActions.slice(1)]);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.artifact.runs[0].output.actionTextQuality.pass, false);
  assert.equal(result.artifact.runs[0].output.actionTextQuality.rows[0].text, copiedFragment);
  assert.equal(
    result.artifact.runs[0].output.actionTextQuality.rows[0].reasonCode,
    "ACTION_TEXT_LEADING_CONNECTIVE",
  );
  assert.ok(result.artifact.runs[0].reasonCodes.includes("ACTION_TEXT_NOT_STANDALONE_IMPERATIVE"));
  assert.equal(result.artifact.verdict, "semantic_failure");
});
