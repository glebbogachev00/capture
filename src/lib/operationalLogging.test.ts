import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "src");

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const operationalAdapters = [
  "lib/providers.ts",
  "lib/openRouterDecisions.server.ts",
  "lib/jevJudgeShadow.ts",
  "lib/jevRecallShadow.ts",
  "lib/jevThreadRerank.ts",
  "lib/cloudBoard.ts",
  "lib/cloudImage.ts",
  "lib/cloudRequestGuard.server.ts",
  "lib/polar.ts",
  "lib/polarServer.ts",
  "lib/accountErasure.ts",
  "lib/accountErasure.server.ts",
  "lib/accountErasureRoutes.server.ts",
  "lib/backupClient.ts",
  "lib/backupTransfer.ts",
  "lib/supabase/repository.ts",
  "proxy.ts",
].map((path) => resolve(root, path));

const managedSources = [
  ...filesBelow(resolve(root, "app/api")),
  ...operationalAdapters,
];

const RAW_LOG_SINK = /(?:console\.(?:log|info|warn|error|debug)|process\.(?:stdout|stderr)\.write|\b(?:logger|log)\.(?:trace|debug|info|warn|error|fatal))\s*\(/;

describe("operational logging source boundary", () => {
  it("keeps raw log sinks out of every API route and operational adapter", () => {
    const offenders = managedSources.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return RAW_LOG_SINK.test(source)
        ? [relative(root, path)]
        : [];
    });
    expect(offenders).toEqual([]);
  });

  it("centralizes the only server operational console call in the fixed logger", () => {
    const source = readFileSync(resolve(root, "lib/opsEvent.server.ts"), "utf8");
    expect(source.match(/console\.(?:log|info|warn|error|debug)\s*\(/g)).toEqual(["console.info("]);
    expect(source).toContain('import "server-only"');
    expect(source).not.toMatch(/\b(error|request|response|url|path|token|email|ownerId|userId|sessionId|operationId|imageId|stack|message)\s*:/);
  });

  it("does not rebuild provider errors from response bodies", () => {
    for (const path of [
      resolve(root, "app/api/transcribe/route.ts"),
      resolve(root, "app/api/tts/route.ts"),
      resolve(root, "lib/providers.ts"),
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/throw new Error\([^\n]*(?:response|upstream|res)\.(?:text|json)\(/);
      expect(source.replace(/\n/g, " ")).not.toMatch(/console\.[a-z]+\([^)]*(?:error|err|\.message|\.stack)/);
    }
  });
});
