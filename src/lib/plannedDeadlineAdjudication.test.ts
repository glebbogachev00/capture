import { describe, expect, it, vi } from "vitest";
import type { SortResult } from "./boardOps";
import {
  DeadlineAdjudicationError,
  adjudicatePlannedDeadlines,
  plannedDeadlineAdjudicationPrompt,
  requiresPlannedDeadlineAdjudication,
  type PlannedDeadlineAdjudication,
} from "./plannedDeadlineAdjudication";
import type { PlannedRoutingPlan, RoutingPlanContext } from "./plannedRouting";

const recovery: SortResult = {
  clean: "synthetic",
  kind: "action",
  title: "Synthetic",
  actions: [],
  primaryActions: [],
  shelfLife: "keep",
  due: null,
  threadId: null,
  threadName: null,
  primaryText: null,
  also: [],
};

const action = (id: string, source: string, text: string) => ({
  id,
  source,
  kind: "action" as const,
  action: text,
  due: null,
  ownerId: null,
  destinations: [],
  duplicateActionId: null,
  unresolved: false,
  ambiguity: null,
});
const deadline = (id: string, source: string, ownerId: string, due = "2026-01-01") => ({
  id,
  source,
  kind: "deadline" as const,
  action: null,
  due,
  ownerId,
  destinations: [],
  duplicateActionId: null,
  unresolved: false,
  ambiguity: null,
});
const context = (raw: string, now: string): RoutingPlanContext => ({
  captureId: "deadline-adjudication",
  raw,
  threads: [],
  actions: [],
  recovery: { ...recovery, clean: raw },
  now: new Date(now).getTime(),
});
const decision = (
  deadlineItemId: string,
  ownerActionId: string,
  due: string,
  calendarOperation: PlannedDeadlineAdjudication["decisions"][number]["calendarOperation"],
): PlannedDeadlineAdjudication["decisions"][number] => ({
  deadlineItemId,
  ownerActionId,
  due,
  calendarOperation,
});

describe("bounded planned deadline adjudication", () => {
  it("resolves the observed Tuesday to next Friday case from exact deadline evidence", async () => {
    const raw = "Review the playback notes next Friday.";
    const plan: PlannedRoutingPlan = {
      items: [
        action("review", "Review the playback notes", "Review the playback notes next Friday"),
        deadline("review-due", " next Friday.", "review", "2026-10-01"),
      ],
      newThreads: [],
    };
    const generate = vi.fn(async (prompt: string) => {
      expect(prompt).toContain("PLANNED DEADLINE ADJUDICATION");
      expect(prompt).toContain('"id":"review-due"');
      expect(prompt).toContain('"source":" next Friday."');
      expect(prompt).toContain('"ownerActionId":"review"');
      expect(prompt).not.toContain("2026-10-01");
      expect(prompt).toContain("Asia/Bangkok");
      return {
        decisions: [decision("review-due", "review", "2026-10-02", {
          type: "next_weekday",
          weekday: "friday",
          occurrence: "strictly_after_today",
        })],
      };
    });

    const result = await adjudicatePlannedDeadlines({
      plan,
      context: context(raw, "2026-09-29T12:00:00+07:00"),
      timeZone: "Asia/Bangkok",
      generate,
    });

    expect(generate).toHaveBeenCalledOnce();
    expect(result.items[1]).toEqual({ ...plan.items[1], due: "2026-10-02" });
    expect(result.items.map((item) => item.source).join("")).toBe(raw);
  });

  it.each([
    ["month rollover", "2026-01-31T12:00:00+07:00", "2026-02-01"],
    ["year rollover", "2026-12-31T12:00:00+07:00", "2027-01-01"],
  ])("validates tomorrow across a $label", async (_label, now, expectedDue) => {
    const raw = "Catalog the archive tomorrow.";
    const plan: PlannedRoutingPlan = {
      items: [
        action("catalog", "Catalog the archive", "Catalog the archive tomorrow"),
        deadline("catalog-due", " tomorrow.", "catalog"),
      ],
      newThreads: [],
    };
    const result = await adjudicatePlannedDeadlines({
      plan,
      context: context(raw, now),
      timeZone: "Asia/Bangkok",
      generate: vi.fn().mockResolvedValue({
        decisions: [decision("catalog-due", "catalog", expectedDue, {
          type: "day_offset",
          days: 1,
        })],
      }),
    });
    expect(result.items[1].due).toBe(expectedDue);
  });

  it("treats a named weekday matching today as seven days later", async () => {
    const raw = "Inspect the sensors next Friday.";
    const plan: PlannedRoutingPlan = {
      items: [
        action("inspect", "Inspect the sensors", "Inspect the sensors next Friday"),
        deadline("inspect-due", " next Friday.", "inspect"),
      ],
      newThreads: [],
    };
    const result = await adjudicatePlannedDeadlines({
      plan,
      context: context(raw, "2026-01-30T23:30:00+07:00"),
      timeZone: "Asia/Bangkok",
      generate: vi.fn().mockResolvedValue({
        decisions: [decision("inspect-due", "inspect", "2026-02-06", {
          type: "next_weekday",
          weekday: "friday",
          occurrence: "strictly_after_today",
        })],
      }),
    });
    expect(result.items[1].due).toBe("2026-02-06");
  });

  it("requires complete decisions for multiple deadlines and applies only due", async () => {
    const raw = "Send the index tomorrow. Review the notes next Friday.";
    const plan: PlannedRoutingPlan = {
      items: [
        action("send", "Send the index", "Send the index tomorrow"),
        deadline("send-due", " tomorrow. ", "send"),
        action("review", "Review the notes", "Review the notes next Friday"),
        deadline("review-due", " next Friday.", "review"),
      ],
      newThreads: [],
    };
    const snapshot = structuredClone(plan);
    const result = await adjudicatePlannedDeadlines({
      plan,
      context: context(raw, "2026-09-29T12:00:00+07:00"),
      timeZone: "Asia/Bangkok",
      generate: vi.fn().mockResolvedValue({ decisions: [
        decision("send-due", "send", "2026-09-30", { type: "day_offset", days: 1 }),
        decision("review-due", "review", "2026-10-02", {
          type: "next_weekday",
          weekday: "friday",
          occurrence: "strictly_after_today",
        }),
      ] }),
    });
    expect(result.items.map((item) => item.due)).toEqual([null, "2026-09-30", null, "2026-10-02"]);
    expect(plan).toEqual(snapshot);
  });

  it.each([
    ["malformed schema", { decisions: [{ deadlineItemId: "due" }] }],
    ["unknown deadline id", { decisions: [decision("unknown", "act", "2026-09-30", { type: "day_offset", days: 1 })] }],
    ["missing known id", { decisions: [] }],
    ["duplicate known id", { decisions: [
      decision("due", "act", "2026-09-30", { type: "day_offset", days: 1 }),
      decision("due", "act", "2026-09-30", { type: "day_offset", days: 1 }),
    ] }],
    ["changed owner", { decisions: [decision("due", "other", "2026-09-30", { type: "day_offset", days: 1 })] }],
    ["inconsistent day offset and ISO", { decisions: [decision("due", "act", "2026-10-01", { type: "day_offset", days: 1 })] }],
    ["inconsistent weekday and ISO", { decisions: [decision("due", "act", "2026-10-01", {
      type: "next_weekday", weekday: "friday", occurrence: "strictly_after_today",
    })] }],
    ["inconsistent fixed operation and ISO", { decisions: [decision("due", "act", "2026-10-01", {
      type: "fixed", iso: "2026-10-02",
    })] }],
  ])("fails closed on %s", async (_label, output) => {
    const raw = "Do the task tomorrow.";
    const plan: PlannedRoutingPlan = {
      items: [action("act", "Do the task", "Do the task tomorrow"), deadline("due", " tomorrow.", "act")],
      newThreads: [],
    };
    const snapshot = structuredClone(plan);
    await expect(adjudicatePlannedDeadlines({
      plan,
      context: context(raw, "2026-09-29T12:00:00+07:00"),
      timeZone: "Asia/Bangkok",
      generate: vi.fn().mockResolvedValue(output),
    })).rejects.toBeInstanceOf(DeadlineAdjudicationError);
    expect(plan).toEqual(snapshot);
  });

  it("skips generation when there are no stable deadline items", async () => {
    const raw = "Do the task.";
    const plan: PlannedRoutingPlan = { items: [action("act", raw, "Do the task")], newThreads: [] };
    const generate = vi.fn();
    expect(requiresPlannedDeadlineAdjudication(plan)).toBe(false);
    await expect(adjudicatePlannedDeadlines({
      plan,
      context: context(raw, "2026-09-29T12:00:00+07:00"),
      timeZone: "Asia/Bangkok",
      generate,
    })).resolves.toEqual(plan);
    expect(generate).not.toHaveBeenCalled();
  });

  it("exposes only stable ids, exact phrases, owners, date, and timezone to the date model", () => {
    const raw = "Do the task tomorrow.";
    const plan: PlannedRoutingPlan = {
      items: [action("act", "Do the task", "Do the task tomorrow"), deadline("due", " tomorrow.", "act", "1900-01-01")],
      newThreads: [],
    };
    const prompt = plannedDeadlineAdjudicationPrompt(
      plan,
      context(raw, "2026-09-29T23:30:00+07:00"),
      "Asia/Bangkok",
    );
    expect(prompt).toContain('"id":"due"');
    expect(prompt).toContain('"source":" tomorrow."');
    expect(prompt).toContain('"ownerActionId":"act"');
    expect(prompt).toContain("2026-09-29");
    expect(prompt).toContain("Asia/Bangkok");
    expect(prompt).not.toContain("1900-01-01");
    expect(prompt).not.toContain("Do the task tomorrow");
  });
});
