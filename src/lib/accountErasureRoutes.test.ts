import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  accountErasureWorkerSecret,
  authorizeAccountErasureWorker,
} from "./accountErasureRoutes.server";

const routes = ["prepare", "status", "confirm", "worker"] as const;

describe("account erasure route source contracts", () => {
  it.each(routes)("exposes only POST at /api/cloud/account-erasure/%s with a bounded runtime", route => {
    const source = readFileSync(`src/app/api/cloud/account-erasure/${route}/route.ts`, "utf8");
    expect(source).toContain("export async function POST");
    expect(source).toContain("export const maxDuration = 60");
    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).not.toMatch(/export async function (GET|PUT|PATCH|DELETE)/);
    expect(source).not.toMatch(/console\.(log|info|warn|error)/);
  });

  it("uses a distinct constant-time worker bearer and fails closed when it is absent", () => {
    const secret = "s".repeat(32);
    expect(accountErasureWorkerSecret({ CAPTURE_ACCOUNT_ERASURE_WORKER_SECRET: `  ${secret}  ` })).toBe(secret);
    expect(accountErasureWorkerSecret({})).toBeNull();
    expect(accountErasureWorkerSecret({ CAPTURE_ACCOUNT_ERASURE_WORKER_SECRET: "s".repeat(31) })).toBeNull();
    expect(authorizeAccountErasureWorker(new Request("https://capture.test", {
      method: "POST", headers: { authorization: `Bearer ${secret}` },
    }), { CAPTURE_ACCOUNT_ERASURE_WORKER_SECRET: secret })).toBe("authorized");
    expect(authorizeAccountErasureWorker(new Request("https://capture.test", {
      method: "POST", headers: { authorization: "Bearer wrong" },
    }), { CAPTURE_ACCOUNT_ERASURE_WORKER_SECRET: secret })).toBe("unauthorized");
    expect(authorizeAccountErasureWorker(new Request("https://capture.test", { method: "POST" }), {})).toBe("unavailable");

    const factory = readFileSync("src/lib/accountErasureRoutes.server.ts", "utf8");
    expect(factory).toContain("const workerSecret = accountErasureWorkerSecret(env)");
    expect(factory).toMatch(/workerConfigured\s*=\s*!!polarConfig\s*&&\s*hostedReady\s*&&\s*inventoryAttested\s*&&\s*!!workerSecret/);
    expect(factory).toContain("const configured = accountErasureWorkerSecret(env)");
  });

  it("runs one bounded replay-safe stage per authorized worker request", () => {
    const source = readFileSync("src/app/api/cloud/account-erasure/worker/route.ts", "utf8");
    expect(source).toContain("createAccountErasureRouteDependencies");
    expect(source).toContain("runAccountErasureWorker(");
    expect(source).not.toContain("while (");
  });

  it("pins every hosted activation blocker in the internal contract", () => {
    const factory = readFileSync("src/lib/accountErasureRoutes.server.ts", "utf8");
    for (const gate of [
      "CAPTURE_ACCOUNT_ERASURE_ENABLED",
      "CAPTURE_ACCOUNT_ERASURE_HOSTED_READY",
      "CAPTURE_ERASURE_STORAGE_INVENTORY_ATTESTED",
    ]) expect(factory).toContain(gate);
    for (const adapter of [
      "createPolarErasureAdapter",
      "createSessionFenceAdapter",
      "createStorageErasureAdapter",
      "createAppDataErasureAdapter",
      "createAuthErasureAdapter",
    ]) expect(factory).toContain(adapter);

    const contract = readFileSync("docs/cloud-account-erasure.md", "utf8").toLowerCase();
    for (const blocker of [
      "fence/session",
      "bucket/quiescence",
      "otp-claims",
      "polar capability/error",
      "auth-readback",
      "grants",
    ]) expect(contract).toContain(blocker);
    expect(contract).toContain("confirmation and worker execution remain configuration-stopped");
  });
});
