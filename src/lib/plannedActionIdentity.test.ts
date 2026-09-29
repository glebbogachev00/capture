import { describe, expect, it, vi } from "vitest";
import type { SortResult } from "./boardOps";
import {
  ActionIdentityAdjudicationError,
  adjudicatePlannedActionIdentity,
  assertOnlyActionIdentityChanged,
  type ActionIdentityAdjudication,
} from "./plannedActionIdentity";
import type { PlannedRoutingPlan, RoutingPlanContext } from "./plannedRouting";

const recovery: SortResult = {
  clean: "synthetic",
  kind: "action",
  title: "Synthetic actions",
  actions: [],
  primaryActions: [],
  shelfLife: "keep",
  due: null,
  threadId: null,
  threadName: null,
  primaryText: null,
  also: [],
};

const actionItem = (
  id: string,
  source: string,
  action: string,
  duplicateActionId: string | null = null,
) => ({
  id,
  source,
  kind: "action" as const,
  action,
  due: null,
  ownerId: null,
  destinations: [],
  duplicateActionId,
  unresolved: false,
  ambiguity: null,
});

const plan = (items: PlannedRoutingPlan["items"]): PlannedRoutingPlan => ({
  items,
  newThreads: [],
});

const context = (
  raw: string,
  actions: RoutingPlanContext["actions"],
): RoutingPlanContext => ({
  captureId: "capture-action-identity",
  raw,
  threads: [],
  actions,
  recovery: { ...recovery, clean: raw },
  now: new Date("2026-09-29T12:00:00+07:00").getTime(),
});

const decisions = (
  ...values: ActionIdentityAdjudication["decisions"]
): ActionIdentityAdjudication => ({ decisions: values });

const reuse = (
  proposedActionId: string,
  existingActionId: string,
  rationale = "The two Actions close the same intended outcome.",
): ActionIdentityAdjudication["decisions"][number] => ({
  proposedActionId,
  outcome: "existing",
  existingActionId,
  relation: "same_outcome",
  rationale,
});

const fresh = (
  proposedActionId: string,
  closestExistingActionId: string,
  rationale = "A separate intended result remains after the existing Action is complete.",
): ActionIdentityAdjudication["decisions"][number] => ({
  proposedActionId,
  outcome: "new",
  closestExistingActionId,
  relation: "distinct_outcome",
  rationale,
});

describe("model-owned planned Action identity", () => {
  it("requires a new Action decision to identify and contrast the closest supplied Action", async () => {
    const raw = "Email the orchard map to the irrigation installer.";
    const proposed = plan([
      actionItem("send-map", raw, "Email the orchard map to the irrigation installer"),
    ]);

    const result = await adjudicatePlannedActionIdentity({
      plan: proposed,
      context: context(raw, [{
        id: "draw-map",
        text: "Finish drawing the orchard irrigation map",
      }]),
      generate: vi.fn().mockResolvedValue({
        decisions: [{
          proposedActionId: "send-map",
          outcome: "new",
          closestExistingActionId: "draw-map",
          relation: "distinct_outcome",
          rationale: "Finishing the drawing does not deliver it to the installer.",
        }],
      }),
    });

    expect(result.items[0].duplicateActionId).toBeNull();
  });

  it("marks a cross-domain paraphrase as the supplied existing Action", async () => {
    const raw = "Check that the museum booking is confirmed.";
    const proposed = plan([
      actionItem("museum-check", raw, "Check that the museum booking is confirmed"),
    ]);
    const generate = vi.fn().mockResolvedValue(decisions(
      reuse("museum-check", "museum-reservation"),
    ));

    const result = await adjudicatePlannedActionIdentity({
      plan: proposed,
      context: context(raw, [{
        id: "museum-reservation",
        text: "Confirm the venue reservation with the museum",
      }]),
      generate,
    });

    expect(result.items[0].duplicateActionId).toBe("museum-reservation");
    expect(generate).toHaveBeenCalledOnce();
  });

  it("reuses the exact P6 paraphrase fixture without changing its source", async () => {
    const raw = "Look over the made-up lesson plan.";
    const proposed = plan([
      actionItem("lesson-review", raw, "Look over the made-up lesson plan"),
    ]);

    const result = await adjudicatePlannedActionIdentity({
      plan: proposed,
      context: context(raw, [{
        id: "seed-action-1",
        text: "Review the synthetic lesson outline",
      }]),
      generate: vi.fn().mockResolvedValue(decisions(
        reuse(
          "lesson-review",
          "seed-action-1",
          "Both Actions finish by reviewing the same fictional lesson plan.",
        ),
      )),
    });

    expect(result.items[0]).toEqual({
      ...proposed.items[0],
      duplicateActionId: "seed-action-1",
    });
  });

  it("uses the model-selected id when more than one existing Action could match", async () => {
    const raw = "Confirm the gallery reservation.";
    const proposed = plan([
      actionItem("gallery-check", raw, "Confirm the gallery reservation"),
    ]);

    const result = await adjudicatePlannedActionIdentity({
      plan: proposed,
      context: context(raw, [
        { id: "gallery-booking-a", text: "Verify the gallery booking" },
        { id: "gallery-booking-b", text: "Check that the gallery reservation is confirmed" },
      ]),
      generate: vi.fn().mockResolvedValue(decisions(
        reuse("gallery-check", "gallery-booking-b"),
      )),
    });

    expect(result.items[0].duplicateActionId).toBe("gallery-booking-b");
  });

  it("preserves a same-subject follow-up whose finish line remains distinct", async () => {
    const raw = "Email the orchard map to the irrigation installer.";
    const proposed = plan([
      actionItem("send-map", raw, "Email the orchard map to the irrigation installer"),
    ]);

    const result = await adjudicatePlannedActionIdentity({
      plan: proposed,
      context: context(raw, [{
        id: "draw-map",
        text: "Finish drawing the orchard irrigation map",
      }]),
      generate: vi.fn().mockResolvedValue(decisions(fresh("send-map", "draw-map"))),
    });

    expect(result.items[0].duplicateActionId).toBeNull();
  });

  it("adjudicates multiple proposed Actions against multiple existing Actions by id", async () => {
    const raw = "Verify the ferry tickets. Send the passenger list to the harbor office.";
    const proposed = plan([
      actionItem("tickets", "Verify the ferry tickets. ", "Verify the ferry tickets"),
      actionItem("passengers", "Send the passenger list to the harbor office.", "Send the passenger list to the harbor office"),
    ]);
    const generate = vi.fn().mockResolvedValue(decisions(
      fresh("passengers", "harbor-permit"),
      reuse("tickets", "ferry-booking"),
    ));

    const result = await adjudicatePlannedActionIdentity({
      plan: proposed,
      context: context(raw, [
        { id: "ferry-booking", text: "Confirm all ferry reservations" },
        { id: "harbor-permit", text: "Request the harbor access permit" },
      ]),
      generate,
    });

    expect(result.items.map((item) => item.duplicateActionId)).toEqual([
      "ferry-booking",
      null,
    ]);
  });

  it.each([
    ["missing proposed id", decisions(fresh("unknown", "existing"))],
    ["missing decision", decisions()],
    ["duplicate decision", decisions(
      fresh("one", "existing"),
      fresh("one", "existing"),
    )],
    ["unknown existing id", decisions(reuse("one", "missing"))],
    ["unknown closest id", decisions(fresh("one", "missing"))],
    ["null closest id", {
      decisions: [{
        proposedActionId: "one",
        outcome: "new",
        closestExistingActionId: null,
        relation: "distinct_outcome",
        rationale: "Synthetic distinction.",
      }],
    }],
    ["ambiguous decision", {
      decisions: [{
        proposedActionId: "one",
        outcome: "ambiguous",
        closestExistingActionId: "existing",
        rationale: "The finish line cannot be distinguished.",
      }],
    }],
    ["malformed branch", {
      decisions: [{ proposedActionId: "one", outcome: "new", existingActionId: "existing" }],
    }],
  ])("fails closed for %s without applying a partial judgment", async (_label, output) => {
    const raw = "Review the synthetic brief.";
    const proposed = plan([actionItem("one", raw, "Review the synthetic brief")]);

    await expect(adjudicatePlannedActionIdentity({
      plan: proposed,
      context: context(raw, [{ id: "existing", text: "Read the synthetic brief" }]),
      generate: vi.fn().mockResolvedValue(output),
    })).rejects.toBeInstanceOf(ActionIdentityAdjudicationError);

    expect(proposed.items[0].duplicateActionId).toBeNull();
  });

  it.each([
    ["missing decision", decisions(), "COVERAGE_INVALID"],
    ["unknown existing id", decisions(reuse("one", "missing")), "ACTION_ID_INVALID"],
    ["unknown closest id", decisions(fresh("one", "missing")), "ACTION_ID_INVALID"],
    ["malformed branch", {
      decisions: [{ proposedActionId: "one", outcome: "new", existingActionId: "existing" }],
    }, "OUTPUT_SCHEMA_INVALID"],
  ])("exposes fixed privacy-safe rejection code for %s", async (_label, output, code) => {
    const raw = "Review the synthetic brief.";
    try {
      await adjudicatePlannedActionIdentity({
        plan: plan([actionItem("one", raw, "Review the synthetic brief")]),
        context: context(raw, [{ id: "existing", text: "Read the synthetic brief" }]),
        generate: vi.fn().mockResolvedValue(output),
      });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ActionIdentityAdjudicationError);
      expect((error as ActionIdentityAdjudicationError).code).toBe(code);
    }
  });

  it.each([
    ["provider failure", () => Promise.reject(new Error("provider unavailable"))],
    ["deadline abort", () => Promise.reject(new DOMException("timed out", "AbortError"))],
  ])("fails closed on %s", async (_label, generate) => {
    const raw = "Review the synthetic brief.";

    await expect(adjudicatePlannedActionIdentity({
      plan: plan([actionItem("one", raw, "Review the synthetic brief")]),
      context: context(raw, [{ id: "existing", text: "Read the synthetic brief" }]),
      generate,
    })).rejects.toThrow();
  });

  it("preserves exact source, provenance fields, destinations, and owned deadlines", async () => {
    const raw = "Archive the kiln report next Friday.";
    const proposed = plan([
      actionItem("archive", "Archive the kiln report", "Archive the kiln report next Friday"),
      {
        id: "deadline",
        source: " next Friday.",
        kind: "deadline",
        action: null,
        due: "2026-10-02",
        ownerId: "archive",
        destinations: [],
        duplicateActionId: null,
        unresolved: false,
        ambiguity: null,
      },
    ]);
    const snapshot = structuredClone(proposed);

    const result = await adjudicatePlannedActionIdentity({
      plan: proposed,
      context: context(raw, [{ id: "archive-existing", text: "File the kiln report" }]),
      generate: vi.fn().mockResolvedValue(decisions(
        reuse("archive", "archive-existing"),
      )),
    });

    const withoutIdentity = ({ duplicateActionId, ...item }: PlannedRoutingPlan["items"][number]) => {
      void duplicateActionId;
      return item;
    };
    expect(result.items.map(withoutIdentity)).toEqual(snapshot.items.map(withoutIdentity));
    expect(result.items[1]).toEqual(snapshot.items[1]);
  });

  it.each([
    ["source", (candidate: PlannedRoutingPlan) => {
      candidate.items[0].source = "Altered source.";
    }],
    ["kind", (candidate: PlannedRoutingPlan) => {
      candidate.items[0].kind = "intention";
      candidate.items[0].action = null;
    }],
    ["destination", (candidate: PlannedRoutingPlan) => {
      candidate.items[0].destinations = [{ type: "new", newThreadKey: "changed" }];
      candidate.newThreads = [{
        key: "changed",
        name: "Changed destination",
        closestExistingThreadId: null,
        whyNew: "Synthetic mutation",
      }];
    }],
    ["deadline", (candidate: PlannedRoutingPlan) => {
      candidate.items[1].due = "2026-10-03";
    }],
    ["new Thread metadata", (candidate: PlannedRoutingPlan) => {
      candidate.newThreads = [{
        key: "changed",
        name: "Changed destination",
        closestExistingThreadId: null,
        whyNew: "Synthetic mutation",
      }];
    }],
  ])("fails closed when adjudication changes the plan's %s bytes", (_label, mutate) => {
    const before = plan([
      actionItem("archive", "Archive the kiln report", "Archive the kiln report next Friday"),
      {
        id: "deadline",
        source: " next Friday.",
        kind: "deadline",
        action: null,
        due: "2026-10-02",
        ownerId: "archive",
        destinations: [],
        duplicateActionId: null,
        unresolved: false,
        ambiguity: null,
      },
    ]);
    const after = structuredClone(before);
    after.items[0].duplicateActionId = "archive-existing";
    mutate(after);

    expect(() => assertOnlyActionIdentityChanged(before, after)).toThrow(
      ActionIdentityAdjudicationError,
    );
  });

  it("rejects duplicateActionId mutation outside proposed Action items", () => {
    const before = plan([
      actionItem("archive", "Archive the kiln report", "Archive the kiln report next Friday"),
      {
        id: "deadline",
        source: " next Friday.",
        kind: "deadline",
        action: null,
        due: "2026-10-02",
        ownerId: "archive",
        destinations: [],
        duplicateActionId: null,
        unresolved: false,
        ambiguity: null,
      },
    ]);
    const after = structuredClone(before);
    after.items[0].duplicateActionId = "archive-existing";
    after.items[1].duplicateActionId = "archive-existing";

    expect(() => assertOnlyActionIdentityChanged(before, after)).toThrow(
      ActionIdentityAdjudicationError,
    );
  });

  it("accepts an Action-id decision only when every other plan byte is unchanged", () => {
    const before = plan([
      actionItem("archive", "Archive the kiln report.", "Archive the kiln report"),
    ]);
    const after = structuredClone(before);
    after.items[0].duplicateActionId = "archive-existing";

    expect(() => assertOnlyActionIdentityChanged(before, after)).not.toThrow();
  });

  it("makes no model call when no semantic comparison is possible", async () => {
    const raw = "Review the synthetic brief.";
    const generate = vi.fn();

    const result = await adjudicatePlannedActionIdentity({
      plan: plan([actionItem("one", raw, "Review the synthetic brief")]),
      context: context(raw, []),
      generate,
    });

    expect(result.items[0].duplicateActionId).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });
});
