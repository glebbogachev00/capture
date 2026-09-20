import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  scheduleJevJudgeShadow: vi.fn(),
  withFallback: vi.fn(),
}));

vi.mock("ai", () => ({ generateObject: mocks.generateObject }));
vi.mock("@/lib/clientIp", () => ({ clientIp: () => "synthetic" }));
vi.mock("@/lib/limiter", () => ({ modelRateLimit: () => ({ allowed: true }) }));
vi.mock("@/lib/routing", () => ({ preferredFor: () => "groq" }));
vi.mock("@/lib/providers", () => ({ withFallback: mocks.withFallback }));
vi.mock("@/lib/jevJudgeShadow", () => ({
  scheduleJevJudgeShadow: mocks.scheduleJevJudgeShadow,
}));

import { POST } from "@/app/api/judge/route";

const candidates = [
  {
    id: "fold_action:a1:t1",
    kind: "fold_action",
    source: "Compare annual and monthly pricing",
    target: "Pricing decisions",
    targetContext: "Packaging and annual-plan tradeoffs.",
  },
  {
    id: "fold_action:a2:t2",
    kind: "fold_action",
    source: "Call the vet about Luna's shots",
    target: "Webhook reliability",
    targetContext: "Retry timing and failed deliveries.",
  },
];

beforeEach(() => {
  mocks.withFallback.mockImplementation(async (attempt: (tier: object) => Promise<unknown>) => ({
    value: await attempt({ model: "synthetic-model" }),
    via: "groq",
  }));
  mocks.generateObject.mockImplementation(async ({ schema, prompt }) => {
    expect(prompt).toContain(candidates[0].source);
    expect(prompt).toContain(candidates[1].source);
    return {
      object: schema.parse({
        verdicts: [
          { n: 1, keep: true, reason: "Both concern the pricing decision." },
          { n: 2, keep: false, reason: null },
        ],
      }),
    };
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("judge route Jev shadow", () => {
  it("preserves the full generative batch and judge reasons while scheduling an inert shadow", async () => {
    mocks.scheduleJevJudgeShadow.mockReturnValue(false);

    const response = await POST(new Request("http://localhost/api/judge", {
      method: "POST",
      body: JSON.stringify({ candidates }),
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.verdicts).toEqual([
      {
        id: candidates[0].id,
        keep: true,
        reason: "Both concern the pricing decision.",
      },
      { id: candidates[1].id, keep: false, reason: null },
    ]);
    expect(mocks.scheduleJevJudgeShadow).toHaveBeenCalledWith({
      candidates,
      generativeVerdicts: payload.verdicts,
    });
  });
});
