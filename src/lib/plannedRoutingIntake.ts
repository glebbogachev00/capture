import { z } from "zod";
import { IMG, type Board } from "./model";
import { settleUnsortedCapture } from "./settle";
import {
  PlannedRoutingPlanSchema,
  type PlannedRoutingPlan,
} from "./plannedRouting";
import type { SortResult } from "./boardOps";

const RecoverySchema = z.object({
  clean: z.string(),
  kind: z.enum(["action", "thread", "intention", "both"]),
  title: z.string(),
  actions: z.array(z.string()).optional(),
  primaryActions: z.array(z.string()).nullable().optional(),
  shelfLife: z.string().optional(),
  due: z.string().nullable().optional(),
  threadId: z.string().nullable().optional(),
  threadName: z.string().nullable().optional(),
  primaryText: z.string().nullable().optional(),
  also: z.array(z.object({
    text: z.string(),
    threadId: z.string().nullable().optional(),
    threadName: z.string().nullable().optional(),
  })).nullable().optional(),
}).passthrough();

const PlannedResponseSchema = z.object({
  planned: z.literal(true),
  captureId: z.string().min(1),
  routingPlan: PlannedRoutingPlanSchema,
  recovery: RecoverySchema,
  via: z.string().optional(),
}).passthrough();

export type PlannedRoutingResponse = {
  routingPlan: PlannedRoutingPlan;
  recovery: SortResult;
  via?: string;
};

export type PlannedIntakeInput = {
  captureId: string;
  /** Immutable provenance/Record wording. */
  raw: string;
  /** Semantic and operational wording after explicit command stripping. */
  payload: string;
  transcript?: string;
  images: { id: string; src: string }[];
  imageIds?: string[];
  at: number;
  dictated: boolean;
  openThreadId?: string;
};

type ComposerImage = PlannedIntakeInput["images"][number];

/** Remove only the exact attachment versions durably accepted by this intake.
 * Edits, removals, and additions made while IndexedDB is writing remain the
 * composer's current authority. */
export function reconcilePersistedComposerImages(
  current: ComposerImage[],
  persistedSnapshot: ComposerImage[],
  mintId: () => string,
): ComposerImage[] {
  const unmatched = [...persistedSnapshot];
  const occupied = new Set([
    ...current.map((picture) => picture.id),
    ...persistedSnapshot.map((picture) => picture.id),
  ]);
  const remint = () => {
    let id = mintId();
    while (occupied.has(id)) id = mintId();
    occupied.add(id);
    return id;
  };
  return current.flatMap((picture) => {
    const index = unmatched.findIndex((snapshot) =>
      snapshot.id === picture.id && snapshot.src === picture.src
    );
    if (index < 0) {
      const idWasPersistedWithDifferentBytes = persistedSnapshot.some((snapshot) =>
        snapshot.id === picture.id && snapshot.src !== picture.src
      );
      return [{
        ...picture,
        ...(idWasPersistedWithDifferentBytes ? { id: remint() } : {}),
      }];
    }
    unmatched.splice(index, 1);
    return [];
  });
}

/** Purely stage one durable pending envelope. Persistence is deliberately a
 * caller responsibility so the UI can clear only after the atomic write. */
export function stagePlannedRoutingIntake(
  board: Board,
  input: PlannedIntakeInput,
  ids: { itemId: string; ledgerId: string },
) {
  const revision = 1;
  const imageIds = [...new Set([
    ...input.images.map((image) => image.id),
    ...(input.imageIds ?? []),
  ])];
  const settlement = settleUnsortedCapture(board, {
    raw: input.raw,
    payload: input.payload,
    imgIds: imageIds,
    at: input.at,
    dictated: input.dictated,
    transcript: input.transcript,
    openThreadId: input.openThreadId,
    pendingRevision: revision,
  }, {
    ...ids,
    captureId: input.captureId,
  });
  return {
    ...settlement,
    captureId: input.captureId,
    revision,
    imageEntries: input.images.map((image) => [IMG(image.id), image.src] as [string, string]),
  };
}

/** Treat the route as hostile input. A legacy preview or partial planned
 * response cannot authorize a board write. */
export function parsePlannedRoutingResponse(
  value: unknown,
  captureId: string,
): PlannedRoutingResponse | null {
  const parsed = PlannedResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.captureId !== captureId) return null;
  return {
    routingPlan: parsed.data.routingPlan,
    recovery: parsed.data.recovery as SortResult,
    ...(parsed.data.via ? { via: parsed.data.via } : {}),
  };
}