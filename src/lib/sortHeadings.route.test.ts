import { afterEach, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ generateObject: vi.fn(), generateText: vi.fn() }));
vi.mock("ai", () => ai);
vi.mock("@/lib/clientIp", () => ({ clientIp: () => "synthetic" }));
vi.mock("@/lib/limiter", () => ({ modelRateLimit: () => ({ allowed: true }) }));
vi.mock("@/lib/language.server", () => ({ inCaptureLanguage: async (items: unknown) => items }));
vi.mock("@/lib/actionText.server", () => ({ tightenActions: async (items: unknown) => items }));
vi.mock("@/lib/providers", () => ({
  NoProvidersError: class extends Error {},
  sanitizeProviderError: () => "synthetic provider rejection",
  withFallback: async (call: (tier: object) => Promise<unknown>) => ({ value: await call({ name: "mock", model: "mock" }), via: "mock" }),
}));
import { POST } from "@/app/api/sort/route";
import { SIMPLE_SORT_VERSION } from "@/lib/simpleSort";

afterEach(() => vi.resetAllMocks());

const paragraph = (topic: string) =>
  `This part is about ${topic} and it goes on for a while, because I keep thinking out loud about it. ` +
  `There is a lot to say about ${topic}, so I say it, and then I say a bit more about why ${topic} matters to me right now.`;
const long = ["launch", "launch", "pricing", "pricing", "the team", "the team"].map(paragraph).join("\n\n");

const sort = (raw: string) => POST(new Request("http://localhost/api/sort", {
  method: "POST",
  body: JSON.stringify({ raw, threads: [{ id: "plans", name: "Plans", about: "" }], sortVersion: SIMPLE_SORT_VERSION }),
}));

it("gives a long thought its headings as it will sit in its thread, and only the thought", async () => {
  ai.generateObject.mockResolvedValue({ object: { items: [{ kind: "thought", text: long, threadIds: ["plans"], newThread: null, due: null, sameAsAction: null }] } });
  ai.generateText.mockResolvedValue({ text: '{"headings":[{"before":1,"title":"The launch"},{"before":3,"title":"Pricing"}]}' });
  const response = await sort(long);
  const { sort: out } = await response.json();
  expect(out.items).toHaveLength(1);
  expect(out.items[0].text.split("\n\n").filter((block: string) => block.startsWith("### "))).toEqual(["### The launch", "### Pricing"]);
  expect(ai.generateText).toHaveBeenCalledTimes(1);
  expect(ai.generateText.mock.calls[0][0].prompt).toMatch(/^\[1\] This part is about launch/);
});

it("still sorts the note when naming its parts fails", async () => {
  ai.generateObject.mockResolvedValue({ object: { items: [{ kind: "thought", text: long, threadIds: ["plans"], newThread: null, due: null, sameAsAction: null }] } });
  ai.generateText.mockRejectedValue(new Error("provider down"));
  const { sort: out } = await (await sort(long)).json();
  expect(out.items[0].text).toBe(long);
});

it("asks for nothing on a short note", async () => {
  ai.generateObject.mockResolvedValue({ object: { items: [{ kind: "thought", text: "Pricing feels too low.", threadIds: ["plans"], newThread: null, due: null, sameAsAction: null }] } });
  const { sort: out } = await (await sort("Pricing feels too low.")).json();
  expect(out.items[0].text).toBe("Pricing feels too low.");
  expect(ai.generateText).not.toHaveBeenCalled();
});
