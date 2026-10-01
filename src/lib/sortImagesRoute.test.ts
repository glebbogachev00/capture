import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SORT_IMAGE_BYTES } from "./sortImageDataUrl";

const ai = vi.hoisted(() => ({ generateObject: vi.fn(), generateText: vi.fn() }));
const jev = vi.hoisted(() => ({ scheduleJevThreadRerankShadow: vi.fn() }));
const providers = vi.hoisted(() => ({
  visionEnabled: true,
  providerName: "groq",
  fallbackProviderName: null as string | null,
}));
vi.mock("ai", () => ai);
vi.mock("@/lib/clientIp", () => ({ clientIp: () => "synthetic" }));
vi.mock("@/lib/limiter", () => ({ modelRateLimit: () => ({ allowed: true }) }));
vi.mock("@/lib/jevThreadRerank", () => jev);
vi.mock("@/lib/providers", () => ({
  NoProvidersError: class extends Error {},
  sanitizeProviderError: () => "synthetic failure",
  visionChain: () => providers.visionEnabled ? [{}] : [],
  withFallback: async (call: (tier: object) => Promise<unknown>) => {
    const names = [providers.providerName, providers.fallbackProviderName].filter(Boolean) as string[];
    let lastError: unknown;
    for (const name of names) {
      try {
        return {
          value: await call({
            name,
            model: "mock-model",
            providerOptions: name === "cerebras"
              ? { cerebras: { reasoningEffort: "low", reasoningFormat: "hidden" } }
              : {},
          }),
          via: name,
          preferred: providers.providerName,
          fallback: name !== providers.providerName,
          fallbackReason: name !== providers.providerName ? "provider_failure" : null,
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  },
}));

import { POST } from "@/app/api/sort/route";

const raw = "Capture needs a quiet explanation. Retake playback stalls. Draft labels tomorrow.";
const threads = [
  { id: "capture", name: "Capture filing", about: "Capture filing and retrieval." },
  { id: "retake", name: "Retake workflow", about: "Retake playback and editing." },
];
const png = (marker = 0) => `data:image/png;base64,${Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10, marker,
]).toString("base64")}`;
const jpeg = `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 224, 0]).toString("base64")}`;
const recovery = {
  clean: raw,
  kind: "both",
  title: "Filing and playback",
  actions: ["Draft labels tomorrow"],
  primaryActions: [],
  shelfLife: "keep",
  due: "2026-09-30",
  threadId: "capture",
  threadName: null,
  primaryText: "Capture needs a quiet explanation.",
  also: [{ text: "Retake playback stalls.", threadId: "retake", threadName: null }],
};

const ownershipFromPrompt = async ({ schema, prompt }: { schema?: { parse: (value: unknown) => unknown }; prompt: string }) => {
  const deadlinePrefix = "Deadline items (stable id, exact immutable source phrase, immutable owner Action id):\n";
  const deadlineStart = prompt.indexOf(deadlinePrefix);
  if (deadlineStart >= 0) {
    const jsonStart = deadlineStart + deadlinePrefix.length;
    const jsonEnd = prompt.indexOf("\n\nReturn exactly one decision", jsonStart);
    const candidates = JSON.parse(prompt.slice(jsonStart, jsonEnd)) as Array<{
      id: string;
      source: string;
      ownerActionId: string;
    }>;
    const todayMatch = /Current local calendar date: (\d{4}-\d{2}-\d{2})/.exec(prompt);
    if (!todayMatch) throw new Error("missing deadline calendar authority");
    const today = new Date(`${todayMatch[1]}T12:00:00Z`);
    const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const isoAfter = (days: number) => {
      const shifted = new Date(today);
      shifted.setUTCDate(shifted.getUTCDate() + days);
      return shifted.toISOString().slice(0, 10);
    };
    const decisions = candidates.map((candidate) => {
      const source = candidate.source.toLowerCase();
      if (source.includes("tomorrow")) {
        return {
          deadlineItemId: candidate.id,
          ownerActionId: candidate.ownerActionId,
          due: isoAfter(1),
          calendarOperation: { type: "day_offset", days: 1 },
        };
      }
      const namedWeekday = weekdays.find((weekday) => source.includes(weekday));
      if (namedWeekday) {
        const target = weekdays.indexOf(namedWeekday);
        const offset = (target - today.getUTCDay() + 7) % 7 || 7;
        return {
          deadlineItemId: candidate.id,
          ownerActionId: candidate.ownerActionId,
          due: isoAfter(offset),
          calendarOperation: {
            type: "next_weekday",
            weekday: namedWeekday,
            occurrence: "strictly_after_today",
          },
        };
      }
      const fixed = /\d{4}-\d{2}-\d{2}/.exec(candidate.source)?.[0];
      if (!fixed) throw new Error("unexpected synthetic deadline phrase");
      return {
        deadlineItemId: candidate.id,
        ownerActionId: candidate.ownerActionId,
        due: fixed,
        calendarOperation: { type: "fixed", iso: fixed },
      };
    });
    const object = { decisions };
    return { object: schema ? schema.parse(object) : object };
  }

  const actionPrefix = "Proposed Actions (id, wording, exact provenance source):\n";
  const actionStart = prompt.indexOf(actionPrefix);
  if (actionStart >= 0) {
    const jsonStart = actionStart + actionPrefix.length;
    const jsonEnd = prompt.indexOf("\n\nExisting open Actions", jsonStart);
    const proposed = JSON.parse(prompt.slice(jsonStart, jsonEnd)) as Array<{ id: string }>;
    const existingPrefix = "Existing open Actions (id and wording):\n";
    const existingStart = prompt.indexOf(existingPrefix);
    const existingJsonStart = existingStart + existingPrefix.length;
    const existingJsonEnd = prompt.indexOf("\n\nFor each proposed Action", existingJsonStart);
    const existing = JSON.parse(prompt.slice(existingJsonStart, existingJsonEnd)) as Array<{ id: string }>;
    const object = {
      decisions: proposed.map((candidate) => ({
        proposedActionId: candidate.id,
        outcome: "new",
        closestExistingActionId: existing[0].id,
        relation: "distinct_outcome",
        rationale: "The proposed Action leaves a separate result to complete.",
      })),
    };
    return { object: schema ? schema.parse(object) : object };
  }

  const combinedPrefix = "Developing-thought candidates (stable id, exact immutable source, current untrusted destinations):\n";
  const combinedStart = prompt.indexOf(combinedPrefix);
  if (combinedStart >= 0) {
    const readBlock = <T,>(prefix: string, suffix: string): T => {
      const start = prompt.indexOf(prefix);
      if (start < 0) throw new Error("unexpected combined semantic prompt");
      const jsonStart = start + prefix.length;
      const jsonEnd = prompt.indexOf(suffix, jsonStart);
      return JSON.parse(prompt.slice(jsonStart, jsonEnd)) as T;
    };
    const candidates = readBlock<Array<{
      itemId: string;
      source: string;
      currentDestinations: unknown[];
    }>>(combinedPrefix, "\n\nAvailable existing Threads");
    const proposed = readBlock<Array<{ id: string }>>(
      "Proposed Actions (stable id, wording, exact provenance source):\n",
      "\n\nExisting open Actions",
    );
    const existingActions = readBlock<Array<{ id: string }>>(
      "Existing open Actions (stable id and wording):\n",
      "\n\nDESTINATION DECISIONS",
    );
    const object = {
      destinationDecisions: candidates.map((candidate) => ({
        itemId: candidate.itemId,
        mode: "indivisible",
        destinations: candidate.currentDestinations,
      })),
      actionDecisions: existingActions.length ? proposed.map((candidate) => ({
        proposedActionId: candidate.id,
        outcome: "new",
        closestExistingActionId: existingActions[0].id,
        relation: "distinct_outcome",
        rationale: "The proposed Action leaves a separate result to complete.",
      })) : [],
    };
    return { object: schema ? schema.parse(object) : object };
  }

  const prefix = "Developing-thought items (stable id, immutable exact source, Unicode code-point length, current untrusted destinations):\n";
  const start = prompt.indexOf(prefix);
  if (start < 0) throw new Error("unexpected unmocked model call");
  const jsonStart = start + prefix.length;
  const jsonEnd = prompt.indexOf("\n\nIndexed immutable source ledgers", jsonStart);
  const candidates = JSON.parse(prompt.slice(jsonStart, jsonEnd)) as Array<{
    itemId: string;
    source: string;
    currentDestinations: unknown[];
  }>;
  const object = {
    decisions: candidates.map((candidate) => ({
      itemId: candidate.itemId,
      mode: "indivisible",
      destinations: candidate.currentDestinations,
    })),
  };
  return { object: schema ? schema.parse(object) : object };
};

const request = (over: Record<string, unknown> = {}) =>
  new Request("http://localhost/api/sort", {
    method: "POST",
    body: JSON.stringify({
      captureId: "capture-one",
      raw,
      threads,
      actions: [],
      correctionExamples: [
        {
          capture: "Make the filing handoff quieter.",
          kind: "thread",
          threadId: "capture",
          threadName: "Capture filing",
        },
      ],
      ...over,
    }),
  });

afterEach(() => vi.useRealTimers());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-29T12:00:00+07:00"));
  ai.generateObject.mockReset();
  ai.generateObject.mockImplementation(ownershipFromPrompt);
  ai.generateText.mockReset();
  jev.scheduleJevThreadRerankShadow.mockReset();
  providers.visionEnabled = true;
  providers.providerName = "groq";
  providers.fallbackProviderName = null;
});

describe("sort route images", () => {

  it.each([2, 4])("interprets all %i images independently before ordinary sorting", async (count) => {
    const imgs = Array.from({ length: count }, (_, index) => png(index + 1));
    ai.generateText.mockImplementation(async ({ messages }) => {
      const image = messages[0].content.find((part: { type: string }) => part.type === "image").image;
      const index = imgs.indexOf(image);
      return { text: `Independent image ${index + 1}` };
    });
    ai.generateObject.mockImplementationOnce(async ({ schema, prompt }) => {
      for (let index = 0; index < count; index += 1) {
        expect(prompt).toContain(`Attached photo ${index + 1}: Independent image ${index + 1}`);
      }
      return { object: schema.parse(recovery) };
    });

    const response = await POST(request({
      captureId: undefined,
      imgs,
    }));

    expect(response.status).toBe(200);
    expect(ai.generateText).toHaveBeenCalledTimes(count);
    expect(ai.generateText.mock.calls.map(([options]) =>
      options.messages[0].content.find((part: { type: string }) => part.type === "image").image
    )).toEqual(imgs);
    expect(ai.generateObject).toHaveBeenCalledTimes(1);
  });

  it("keeps the one-image interpretation contract unchanged", async () => {
    ai.generateText.mockResolvedValueOnce({ text: "One ordinary photo" });
    ai.generateObject.mockImplementationOnce(async ({ schema, prompt }) => {
      expect(prompt).toContain("(Attached photo: One ordinary photo)");
      expect(prompt).not.toContain("Attached photo 1:");
      return { object: schema.parse(recovery) };
    });

    const response = await POST(request({
      captureId: undefined,
      imgs: [jpeg],
    }));

    expect(response.status).toBe(200);
    expect(ai.generateText).toHaveBeenCalledTimes(1);
    expect(ai.generateObject).toHaveBeenCalledTimes(1);
  });

  it("fails a one-image sort closed when vision is unavailable", async () => {
    providers.visionEnabled = false;

    const response = await POST(request({
      captureId: undefined,
      imgs: [png()],
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "The sort didn't go through." });
    expect(ai.generateText).not.toHaveBeenCalled();
    expect(ai.generateObject).not.toHaveBeenCalled();
  });

  it.each([
    ["null after provider failure", () => ai.generateText.mockRejectedValueOnce(new Error("vision failed"))],
    ["whitespace", () => ai.generateText.mockResolvedValueOnce({ text: "   \n  " })],
  ])("fails a one-image sort closed when its caption is %s", async (_case, arrange) => {
    arrange();

    const response = await POST(request({
      captureId: undefined,
      imgs: [png()],
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "The sort didn't go through." });
    expect(ai.generateText).toHaveBeenCalledTimes(1);
    expect(ai.generateObject).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3, 4].flatMap((count) => [
    "No description available.",
    "No caption available!",
    "(image only).",
    "'No caption'",
    "*Description unavailable*",
    "No caption,",
    "No description available:",
    "Caption unavailable;",
    "Description unavailable—",
    "No caption available–",
    "Image only-",
    "**(\"No caption available,\")**",
  ].map((sentinel) => [count, sentinel] as const)))(
    "fails a %i-image sort closed when any normalized caption is the placeholder %j",
    async (count, sentinel) => {
      const imgs = Array.from({ length: count }, (_, index) => png(index + 1));
      ai.generateText.mockImplementation(async ({ messages }) => {
        const image = messages[0].content.find((part: { type: string }) => part.type === "image").image;
        const index = imgs.indexOf(image);
        return { text: index === count - 1 ? sentinel : `Independent image ${index + 1}` };
      });

      const response = await POST(request({
        captureId: undefined,
        imgs,
      }));

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "The sort didn't go through." });
      expect(ai.generateText).toHaveBeenCalledTimes(count);
      expect(ai.generateObject).not.toHaveBeenCalled();
    },
  );

  it.each([1, 2, 3, 4])(
    "preserves a near-neighbor caption containing sentinel words for a %i-image sort",
    async (count) => {
      const imgs = Array.from({ length: count }, (_, index) => png(index + 1));
      ai.generateText.mockImplementation(async ({ messages }) => {
        const image = messages[0].content.find((part: { type: string }) => part.type === "image").image;
        const index = imgs.indexOf(image);
        return { text: index === count - 1
          ? "A status card says **(\"No caption available,\")** beside a diagram"
          : `Independent image ${index + 1}` };
      });
      ai.generateObject.mockImplementationOnce(async ({ schema, prompt }) => {
        expect(prompt).toContain("A status card says **(\"No caption available,\")** beside a diagram");
        return { object: schema.parse(recovery) };
      });

      const response = await POST(request({
        captureId: undefined,
        imgs,
      }));

      expect(response.status).toBe(200);
      expect(ai.generateText).toHaveBeenCalledTimes(count);
      expect(ai.generateObject).toHaveBeenCalledTimes(1);
    },
  );

  it("sorts an image-only capture only from a successful image interpretation", async () => {
    ai.generateText.mockResolvedValueOnce({ text: "A handwritten product decision" });
    ai.generateObject.mockImplementationOnce(async ({ schema, prompt }) => {
      expect(prompt).toContain('Raw capture:\n"""Photo: A handwritten product decision"""');
      return { object: schema.parse({ ...recovery, clean: "A handwritten product decision" }) };
    });

    const response = await POST(request({
      raw: "(image only)",
      captureId: undefined,
      imgs: [png()],
    }));

    expect(response.status).toBe(200);
    expect(ai.generateText).toHaveBeenCalledTimes(1);
    expect(ai.generateObject).toHaveBeenCalledTimes(1);
  });

  it("fails a multi-image sort closed when no provider can interpret every image", async () => {
    providers.visionEnabled = false;

    const response = await POST(request({
      captureId: undefined,
      imgs: [
        png(1),
        png(2),
      ],
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "The sort didn't go through." });
    expect(ai.generateText).not.toHaveBeenCalled();
    expect(ai.generateObject).not.toHaveBeenCalled();
  });

  it.each([
    ["more than four images", Array.from({ length: 5 }, (_, index) => png(index))],
    ["a malformed image value", ["https://example.test/not-a-data-url.png"]],
    ["a non-image data URL", ["data:text/plain;base64,SGVsbG8="]],
    ["bad Base64 length", ["data:image/png;base64,AAA"]],
    ["bad Base64 padding", ["data:image/png;base64,AAAA==="]],
    ["bad Base64 characters", ["data:image/png;base64,AA*A"]],
    ["empty decoded bytes", ["data:image/png;base64,"]],
    ["non-image bytes under an image MIME", [
      `data:image/png;base64,${Buffer.from("plain text").toString("base64")}`,
    ]],
    ["a MIME/signature mismatch", [
      `data:image/png;base64,${Buffer.from([255, 216, 255, 224]).toString("base64")}`,
    ]],
    ["an oversized decoded image", [(() => {
      const bytes = Buffer.alloc(MAX_SORT_IMAGE_BYTES + 1);
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
      return `data:image/png;base64,${bytes.toString("base64")}`;
    })()]],
  ])("rejects %s before provider work", async (_case, imgs) => {
    const response = await POST(request({
      captureId: undefined,
      imgs,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad request" });
    expect(ai.generateText).not.toHaveBeenCalled();
    expect(ai.generateObject).not.toHaveBeenCalled();
  });

  it("returns the one-call recovery response for a text capture", async () => {
    ai.generateObject.mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recovery) }));

    const response = await POST(request({ captureId: undefined }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject(recovery);
    expect(body.planned).toBeUndefined();
    expect(body.captureId).toBeUndefined();
    expect(ai.generateObject).toHaveBeenCalledTimes(1);
  });
});
