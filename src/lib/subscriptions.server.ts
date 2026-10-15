import "server-only";

import { spawn } from "node:child_process";
import { accessSync, constants, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SubscriptionProvider, SubscriptionStatus } from "@/lib/aiProviders";
import type { Tier } from "@/lib/providers";

/**
 * A subscription signed in on the Mac a self-hosted Capture runs on — Claude
 * through `claude`, ChatGPT through `codex` — used as a model by running that
 * app once per request. Personal use on the owner's own machine only: never
 * on Capture Cloud or the public trial. Each answer takes several seconds
 * longer than an API key, because the app starts fresh every time.
 */

const BINARIES: Record<SubscriptionProvider, string> = {
  "claude-subscription": "claude",
  "chatgpt-subscription": "codex",
};

/* A background service starts with a short PATH, so look where these apps
   are usually installed as well. */
export function findApp(name: string): string | null {
  const home = process.env.HOME ?? "";
  const dirs = [
    ...(process.env.PATH ?? "").split(":"),
    "/opt/homebrew/bin", "/usr/local/bin", `${home}/.local/bin`, `${home}/.npm-global/bin`, `${home}/.bun/bin`,
  ].filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* keep looking */ }
  }
  return null;
}

type Run = { code: number | null; stdout: string; stderr: string };

function runApp(bin: string, args: string[], options: { input?: string; timeoutMs: number; signal?: AbortSignal; cwd?: string }): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: options.cwd ?? tmpdir(), stdio: ["pipe", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const stop = () => child.kill("SIGKILL");
    const timer = setTimeout(stop, options.timeoutMs);
    options.signal?.addEventListener("abort", stop, { once: true });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", stop);
      if (options.signal?.aborted) reject(options.signal.reason ?? new Error("aborted"));
      else resolve({ code, stdout, stderr });
    });
    child.stdin.end(options.input ?? "");
  });
}

/** Whether each subscription's app is installed here and signed in. */
export async function subscriptionStatus(): Promise<Record<SubscriptionProvider, SubscriptionStatus>> {
  const claude = findApp("claude");
  const codex = findApp("codex");
  const [claudeStatus, codexStatus] = await Promise.all([
    claude
      ? runApp(claude, ["auth", "status", "--json"], { timeoutMs: 30_000 }).then(({ stdout }) => {
          const status = JSON.parse(stdout) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string };
          const signedIn = !!status.loggedIn && status.authMethod === "claude.ai";
          return { installed: true, signedIn, ...(signedIn && status.subscriptionType ? { plan: status.subscriptionType } : {}) };
        }).catch(() => ({ installed: true, signedIn: false }))
      : { installed: false, signedIn: false },
    codex
      ? runApp(codex, ["login", "status"], { timeoutMs: 30_000 }).then(({ stdout, stderr }) => {
          const said = `${stdout}\n${stderr}`;
          return { installed: true, signedIn: /logged in/i.test(said) && !/not logged in/i.test(said) };
        }).catch(() => ({ installed: true, signedIn: false }))
      : { installed: false, signedIn: false },
  ]);
  return { "claude-subscription": claudeStatus, "chatgpt-subscription": codexStatus };
}

/* The AI SDK hands over messages and, for structured answers, a JSON schema;
   the app gets one system text and one prompt. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function promptOf(options: any): { system: string; user: string } {
  let system = "";
  let user = "";
  for (const message of options.prompt ?? []) {
    if (message.role === "system") system += `${message.content}\n`;
    else {
      const text = Array.isArray(message.content)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? message.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n")
        : String(message.content);
      user += (message.role === "user" ? "" : `[${message.role}] `) + text + "\n";
    }
  }
  if (options.responseFormat?.type === "json") {
    system += "\nRespond with only one JSON object: no prose, no code fences.";
    if (options.responseFormat.schema) system += `\nIt must match this JSON schema:\n${JSON.stringify(options.responseFormat.schema)}`;
  }
  return { system: system.trim() || "You are a careful assistant.", user };
}

const unfence = (text: string) => text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

async function answer(provider: SubscriptionProvider, model: string, system: string, user: string, signal?: AbortSignal): Promise<string> {
  const bin = findApp(BINARIES[provider]);
  if (!bin) throw Object.assign(new Error(`${BINARIES[provider]} is not installed on this Mac`), { statusCode: 503 });
  if (provider === "claude-subscription") {
    const { code, stdout, stderr } = await runApp(bin, [
      "-p", "--model", model, "--system-prompt", system, "--tools", "", "--no-session-persistence", "--output-format", "json",
    ], { input: user, timeoutMs: 120_000, signal });
    if (code !== 0) throw Object.assign(new Error(`claude failed: ${stderr.slice(0, 200)}`), { statusCode: /log ?in|auth/i.test(stderr) ? 401 : 502 });
    const result = JSON.parse(stdout) as { result?: string; is_error?: boolean };
    if (result.is_error) throw Object.assign(new Error("claude answered with an error"), { statusCode: 502 });
    return result.result ?? "";
  }
  /* Codex runs read-only in an empty folder and writes only its last message. */
  const work = mkdtempSync(path.join(tmpdir(), "capture-codex-"));
  try {
    const out = path.join(work, "answer.txt");
    const { code, stderr } = await runApp(bin, [
      "exec", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "-C", work, "-o", out,
      ...(model && model !== "default" ? ["-m", model] : []), "-",
    ], { input: `${system}\n\n${user}`, timeoutMs: 120_000, signal, cwd: work });
    if (code !== 0) throw Object.assign(new Error(`codex failed: ${stderr.slice(0, 200)}`), { statusCode: /log ?in|auth/i.test(stderr) ? 401 : 502 });
    return readFileSync(out, "utf8");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** A model that answers through a subscription's app on this Mac. */
export function subscriptionModel(provider: SubscriptionProvider, model: string): Tier["model"] {
  return {
    specificationVersion: "v4",
    provider: provider,
    modelId: model,
    supportedUrls: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async doGenerate(options: any) {
      const { system, user } = promptOf(options);
      const text = unfence(await answer(provider, model, system, user, options.abortSignal));
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: undefined, text: undefined, reasoning: undefined },
        },
        warnings: [],
      };
    },
    async doStream(): Promise<never> {
      throw new Error("subscriptions answer whole, not streamed");
    },
  } as unknown as Tier["model"];
}
