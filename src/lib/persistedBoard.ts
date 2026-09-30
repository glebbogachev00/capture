import { z } from "zod";
import type { Board } from "./model";

const finite = z.number().finite();
const text = z.string();
const stringList = z.array(text);
const authorityCoordinate = z.string().refine((value) =>
  value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value)
);

/**
 * The first Board format predates most Action lifecycle fields. Those fields
 * remain optional at the persisted boundary because hydrate is the explicit
 * migration for that shape; fields that have always carried identity/source
 * meaning stay required.
 */
const PersistedActionSchema = z.object({
  id: text,
  text,
  at: finite,
  done: z.boolean().optional(),
  src: text.optional(),
  imgs: stringList.optional(),
  shelf: z.enum(["hours", "days", "weeks", "keep"]).optional(),
  expires: finite.nullable().optional(),
  due: finite.nullable().optional(),
  doneAt: finite.nullable().optional(),
  faded: z.boolean().optional(),
  fadedAt: finite.nullable().optional(),
  unsorted: z.boolean().optional(),
  pendingRevision: finite.optional(),
  pendingForce: z.enum(["action", "thread", "intention"]).optional(),
  threadId: text.optional(),
  shot: z.object({ threadId: text, fragId: text }).optional(),
  updatedAt: finite.optional(),
}).passthrough();

const PersistedFragSchema = z.object({
  id: text,
  at: finite,
  text,
  imgs: stringList.optional(),
  unsorted: z.boolean().optional(),
  resolvedAt: finite.optional(),
  updatedAt: finite.optional(),
}).passthrough();

const PersistedThreadSchema = z.object({
  id: text,
  name: text,
  temporaryName: z.boolean().optional(),
  summary: text,
  frags: z.array(PersistedFragSchema),
  cover: text.optional(),
  next: text.nullable().optional(),
  nextDismissed: text.optional(),
  belongs: text.optional(),
  updatedAt: finite.optional(),
}).passthrough();

const PersistedIntentionSchema = z.object({
  id: text,
  number: finite,
  rawInput: text,
  expandedIntention: text,
  recommendedActions: stringList,
  counterIntentions: stringList,
  imgs: stringList.optional(),
  at: finite,
  // Intentions created before sync are stamped by hydrate.
  updatedAt: finite.optional(),
}).passthrough();

const PersistedPrincipleSchema = z.object({
  id: text,
  name: text,
  description: text,
  enabled: z.boolean(),
  builtin: z.boolean().optional(),
  updatedAt: finite.optional(),
}).passthrough();

const PersistedCaptureEntrySchema = z.object({
  id: text,
  importBatch: text.optional(),
  at: finite,
  raw: text,
  clean: text,
  kind: z.enum(["pending", "action", "thread", "intention", "both"]),
  partial: z.boolean().optional(),
  pendingRevision: finite.optional(),
  pendingSource: text.optional(),
  source: z.enum(["typed", "dictated", "distill", "image", "import"]),
  targetId: text,
  targetFragId: text.optional(),
  settledBy: z.enum(["manual", "automatic"]).optional(),
  settlementPendingId: text.optional(),
  settlementRevision: finite.optional(),
  settlementArtifacts: z.array(z.object({
    kind: z.enum(["action", "thread", "frag", "intention"]),
    id: text,
  })).optional(),
  modelVia: text.optional(),
  transcript: text.optional(),
  imgs: stringList.optional(),
  openThreadId: text.optional(),
  captureId: text.optional(),
  restored: z.boolean().optional(),
  undone: z.boolean().optional(),
}).passthrough();

const PersistedRoutingSettlementSchema = z.object({
  id: authorityCoordinate,
  captureId: authorityCoordinate,
  pendingId: authorityCoordinate,
  revision: z.number().int().positive().finite(),
  settledBy: z.enum(["manual", "automatic"]),
  artifacts: z.array(z.object({
    kind: z.enum(["action", "thread", "frag", "intention"]),
    id: authorityCoordinate,
  })).min(1).superRefine((artifacts, ctx) => {
    const seen = new Set<string>();
    for (const artifact of artifacts) {
      const coordinate = JSON.stringify([artifact.kind, artifact.id]);
      if (seen.has(coordinate)) {
        ctx.addIssue({ code: "custom", message: "Duplicate settlement artifact" });
      }
      seen.add(coordinate);
    }
  }),
});

const PersistedRoutingRetirementSchema = z.object({
  captureId: authorityCoordinate,
  pendingId: authorityCoordinate,
  revision: z.number().int().positive().finite(),
  retiredAt: z.number().finite().nonnegative(),
});

const PersistedCorrectionEntrySchema = z.object({
  id: text,
  importBatch: text.optional(),
  at: finite,
  proposalKind: z.enum([
    "rename_thread",
    "clean_fragment",
    "extract_action",
    "combine_fragments",
    "refresh_summary",
    "next_step",
    "related_suggestion",
    "refiled",
    "commanded",
    "undone",
  ]),
  accepted: z.boolean(),
  context: text,
  correctionText: text.optional(),
  routing: z.object({
    kind: z.enum(["action", "thread", "intention"]),
    threadId: text.optional(),
    threadName: text.optional(),
  }).optional(),
  rule: text.optional(),
}).passthrough();

const PersistedWrapStatsSchema = z.object({
  day: text,
  said: finite,
  threadsMoved: finite,
  actionsMade: finite,
  intentions: finite,
  threads: z.array(z.object({ name: text, n: finite })),
  firstAt: finite,
  lastAt: finite,
  finished: z.array(z.object({ text, at: finite })),
  returns: z.array(finite),
}).passthrough();

const PersistedDayWrapSchema = z.object({
  importBatch: text.optional(),
  day: text,
  at: finite,
  stats: PersistedWrapStatsSchema,
  line: text,
  insights: z.array(z.object({ k: text, v: text })),
  tomorrow: text,
  via: text.optional(),
  seen: z.boolean().optional(),
}).passthrough();

const PersistedCompletionSchema = z.object({
  importBatch: text.optional(),
  id: text,
  text,
  at: finite,
  threadId: text.optional(),
}).passthrough();

const PersistedProfileSchema = z.object({
  name: text,
  imageId: text.optional(),
  showSignature: z.boolean().optional(),
  intentionShowcaseEnabled: z.boolean().optional(),
  pinnedIntentionIds: z.array(text).optional(),
  intentionShowcaseCollapsed: z.boolean().optional(),
  updatedAt: finite.optional(),
}).passthrough();

/**
 * Complete persisted-domain boundary. Only `actions` and `threads` existed in
 * the oldest supported envelope; every later Board field is optional as an
 * explicit migration, but if present its full current row/nested shape must be
 * valid. Hydrate may add migration defaults, never semantic source fields.
 */
const PersistedBoardSchema = z.object({
  actions: z.array(PersistedActionSchema),
  threads: z.array(PersistedThreadSchema),
  intentions: z.array(PersistedIntentionSchema).optional(),
  principles: z.array(PersistedPrincipleSchema).optional(),
  ledger: z.array(PersistedCaptureEntrySchema).optional(),
  corrections: z.array(PersistedCorrectionEntrySchema).optional(),
  routingSettlements: z.array(PersistedRoutingSettlementSchema).optional(),
  routingRetirements: z.array(PersistedRoutingRetirementSchema).optional(),
  wraps: z.array(PersistedDayWrapSchema).optional(),
  completions: z.array(PersistedCompletionSchema).optional(),
  historyEpoch: finite.optional(),
  historyImports: z.record(text, z.enum(["pending", "accepted"])).optional(),
  profile: PersistedProfileSchema.optional(),
}).passthrough().superRefine((board, ctx) => {
  const settlements = board.routingSettlements ?? [];
  const retirementSlots = new Set<string>();
  (board.routingRetirements ?? []).forEach((retirement, index) => {
    const slot = JSON.stringify([
      retirement.captureId,
      retirement.pendingId,
      retirement.revision,
    ]);
    if (retirementSlots.has(slot)) {
      ctx.addIssue({
        code: "custom",
        message: "Duplicate routing retirement slot",
        path: ["routingRetirements", index],
      });
    }
    retirementSlots.add(slot);
  });
  const ids = new Set<string>();
  const counts = new Map<string, number>();
  const add = (kind: string, id: string) => {
    const coordinate = JSON.stringify([kind, id]);
    counts.set(coordinate, (counts.get(coordinate) ?? 0) + 1);
  };
  for (const action of board.actions) add("action", action.id);
  for (const thread of board.threads) {
    add("thread", thread.id);
    for (const frag of thread.frags) add("frag", frag.id);
  }
  for (const intention of board.intentions ?? []) add("intention", intention.id);

  settlements.forEach((record, index) => {
    if (ids.has(record.id)) {
      ctx.addIssue({
        code: "custom",
        message: "Duplicate routing settlement identity",
        path: ["routingSettlements", index, "id"],
      });
    }
    ids.add(record.id);
    let liveOwned = 0;
    record.artifacts.forEach((artifact, artifactIndex) => {
      const count = counts.get(JSON.stringify([artifact.kind, artifact.id])) ?? 0;
      if (count > 1) {
        ctx.addIssue({
          code: "custom",
          message: "Ambiguous routing artifact coordinate",
          path: ["routingSettlements", index, "artifacts", artifactIndex],
        });
      } else if (count === 1) {
        liveOwned += 1;
      }
    });
    if (liveOwned === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Routing settlement has no provable live artifact",
        path: ["routingSettlements", index, "artifacts"],
      });
    }
  });
});

export function parsePersistedBoard(value: unknown): Partial<Board> | null {
  const parsed = PersistedBoardSchema.safeParse(value);
  return parsed.success ? parsed.data as Partial<Board> : null;
}
