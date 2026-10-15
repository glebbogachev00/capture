// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AiModels } from "./AiModels";
import type { AiConnection } from "@/lib/aiProviders";

const CLAUDE = "sk-ant-api03-" + "b".repeat(40);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function server(initial: AiConnection[]) {
  let connections = initial;
  const sent: unknown[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/ai-settings/models") {
      return Response.json({ provider: "anthropic", models: ["claude-haiku-5-5", "claude-sonnet-5-5"], defaultModel: "claude-haiku-5-5" });
    }
    if (init?.method === "PUT") {
      const rows = JSON.parse(String(init.body)).connections as { id: string; model: string; key?: string }[];
      sent.push(rows);
      connections = rows.map((row) => connections.find((existing) => existing.id === row.id)
        ? { ...connections.find((existing) => existing.id === row.id)!, model: row.model }
        : { id: row.id, provider: "anthropic", model: row.model, hint: row.key!.slice(-4) });
    }
    return Response.json({ mode: "local", connections });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { sent };
}

it("adds a pasted key with the model it can use, and shows only its last four characters", async () => {
  const { sent } = server([]);
  const onCount = vi.fn();
  render(<AiModels onCount={onCount} />);
  const field = await screen.findByLabelText("Paste an API key");
  fireEvent.change(field, { target: { value: CLAUDE } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await screen.findByText(`…${CLAUDE.slice(-4)}`);
  expect((screen.getByLabelText("Model for Claude") as HTMLInputElement).value).toBe("claude-haiku-5-5");
  expect(document.body.textContent).not.toContain(CLAUDE);
  expect(sent[0]).toEqual([{ id: expect.any(String), model: "claude-haiku-5-5", key: CLAUDE }]);
  await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(1));
});

it("reorders and removes by id, without ever resending a key", async () => {
  const { sent } = server([
    { id: "a", provider: "openai", model: "gpt-5-mini", hint: "aaaa" },
    { id: "b", provider: "groq", model: "openai/gpt-oss-120b", hint: "bbbb" },
  ]);
  render(<AiModels />);
  fireEvent.click(await screen.findByRole("button", { name: "Use Groq sooner" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]).toEqual([{ id: "b", model: "openai/gpt-oss-120b" }, { id: "a", model: "gpt-5-mini" }]);
  fireEvent.click(await screen.findByRole("button", { name: "Remove OpenAI" }));
  await waitFor(() => expect(sent).toHaveLength(2));
  expect(sent[1]).toEqual([{ id: "b", model: "openai/gpt-oss-120b" }]);
});

it("says plainly when connecting AI needs Cloud", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "capture cloud access required" }, { status: 402 })));
  render(<AiModels />);
  await screen.findByText("Connecting your own AI is part of Capture Cloud.");
});

it("offers a subscription signed in on this Mac, and says how to sign in to the other", async () => {
  let saved: unknown;
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") saved = JSON.parse(String(init.body)).connections;
    return Response.json({
      mode: "local",
      connections: init?.method === "PUT" ? [{ id: "x", provider: "claude-subscription", model: "claude-haiku-5-5", hint: "" }] : [],
      ...(init?.method === "PUT" ? {} : { subscriptions: {
        "claude-subscription": { installed: true, signedIn: true, plan: "pro" },
        "chatgpt-subscription": { installed: true, signedIn: false },
      } }),
    });
  }));
  render(<AiModels />);
  await screen.findByText(/Signed in on this Mac \(pro\)/);
  expect(screen.getByText(/run codex login in Terminal/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]);
  await waitFor(() => expect(saved).toEqual([{ id: expect.any(String), provider: "claude-subscription", model: "claude-haiku-5-5" }]));
  await screen.findByLabelText("Model for Claude subscription");
  expect(screen.getByText(/run codex login in Terminal/)).toBeTruthy();
});
