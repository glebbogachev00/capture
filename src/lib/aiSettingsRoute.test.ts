import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/ai-settings/route";

const CLAUDE = "sk-ant-api03-" + "b".repeat(40);
const GROQ = "gsk_" + "c".repeat(40);
const put = (connections: unknown) => PUT(new Request("https://capture.test/api/ai-settings", { method: "PUT", body: JSON.stringify({ connections }) }));
const get = async () => (await GET(new Request("https://capture.test/api/ai-settings"))).json();

beforeEach(() => vi.stubEnv("SYNC_DATA_DIR", mkdtempSync(path.join(tmpdir(), "capture-ai-route-"))));
afterEach(() => vi.unstubAllEnvs());

it("adds keys, never returns them, and keeps the order it is given", async () => {
  expect(await get()).toEqual({ mode: "local", connections: [] });
  expect((await put([{ id: "one", model: "claude-haiku-5-5", key: CLAUDE }, { id: "two", model: "openai/gpt-oss-120b", key: GROQ }])).status).toBe(200);
  const body = await get();
  expect(JSON.stringify(body)).not.toContain(CLAUDE);
  expect(body.connections.map((row: { id: string; hint: string }) => [row.id, row.hint])).toEqual([["one", CLAUDE.slice(-4)], ["two", GROQ.slice(-4)]]);

  expect((await put([{ id: "two", model: "openai/gpt-oss-120b" }, { id: "one", model: "claude-sonnet-5-5" }])).status).toBe(200);
  expect((await get()).connections.map((row: { id: string; model: string }) => [row.id, row.model])).toEqual([["two", "openai/gpt-oss-120b"], ["one", "claude-sonnet-5-5"]]);

  expect((await put([{ id: "two", model: "openai/gpt-oss-120b" }])).status).toBe(200);
  expect((await get()).connections).toHaveLength(1);
});

it("refuses rows it cannot trust", async () => {
  expect((await put([{ id: "ghost", model: "gpt-5-mini" }])).status).toBe(400);
  expect((await put([{ id: "one", model: "gpt-5-mini", key: "not a real key" }])).status).toBe(400);
  expect((await put([{ id: "one", model: "bad model name!", key: GROQ }])).status).toBe(400);
  expect((await put("nope")).status).toBe(400);
  expect((await get()).connections).toEqual([]);
});
