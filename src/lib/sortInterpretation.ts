import type { SortResult } from "./boardOps";
import type { SortKind } from "./refiled";

export const MAX_FALLBACK_TITLE_CHARS = 80;

export class UnsafeSortInterpretationError extends Error {
  constructor(message = "The semantic decomposition was incomplete or overlapping.") {
    super(message);
    this.name = "UnsafeSortInterpretationError";
  }
}

export type ThinkingShare = {
  text: string;
  threadId: string | null;
  threadName: string | null;
};

export type InterpretedAction = {
  text: string;
  /** Exact contiguous wording in `clean` owned by this action. */
  sourceText?: string;
  thinkingIndex: number | null;
  shelfLife?: "hours" | "days" | "weeks" | "keep";
  due?: string | null;
};

export type SortInterpretation = {
  clean: string;
  title: string;
  thinking: ThinkingShare[];
  actions: InterpretedAction[];
  intention: string | null;
  /** The thinking share whose fragment owns attached image bytes. */
  imageThinkingIndex?: number | null;
  /** Legacy scalar defaults retained for older local fixtures. New route output
      carries these values on each action. */
  shelfLife: "hours" | "days" | "weeks" | "keep";
  due: string | null;
};

type Options = {
  force?: SortKind;
  validThreadIds: Iterable<string>;
  fallbackText?: string;
  hasImage?: boolean;
  requireCompleteSource?: boolean;
};

type NormalizedAction = {
  text: string;
  source: string;
  thinkingIndex: number | null;
  shelfLife: "hours" | "days" | "weeks" | "keep";
  due: string | null;
};

type NormalizedThinking = ThinkingShare & {
  sourceIndexes: Set<number>;
};

const trimmed = (value: string | null | undefined) => value?.trim() || null;

function boundedTitle(value: string): string {
  const clean = value.trim();
  if (clean.length <= MAX_FALLBACK_TITLE_CHARS) return clean;
  const prefix = clean.slice(0, MAX_FALLBACK_TITLE_CHARS + 1);
  const boundary = prefix.lastIndexOf(" ");
  return (boundary >= MAX_FALLBACK_TITLE_CHARS / 2
    ? prefix.slice(0, boundary)
    : clean.slice(0, MAX_FALLBACK_TITLE_CHARS)).trimEnd();
}

function normalizeActions(
  actions: InterpretedAction[],
  defaults: Pick<SortInterpretation, "shelfLife" | "due">,
): NormalizedAction[] {
  return actions.flatMap((action) => {
    const text = action.text.trim();
    if (!text) return [];
    return [{
      text,
      source: action.sourceText?.trim() || text,
      thinkingIndex: action.thinkingIndex,
      shelfLife: action.shelfLife ?? defaults.shelfLife,
      due: action.due === undefined ? defaults.due : action.due,
    }];
  });
}

function normalizeThinking(
  thinking: ThinkingShare[],
  validThreadIds: Set<string>,
  fallbackName: string,
): { shares: NormalizedThinking[]; destinationForSource: Map<number, number> } {
  const shares: NormalizedThinking[] = [];
  const byDestination = new Map<string, number>();
  const destinationForSource = new Map<number, number>();

  thinking.forEach((share, sourceIndex) => {
    const text = share.text.trim();
    if (!text) return;
    const candidateId = trimmed(share.threadId);
    const threadId = candidateId && validThreadIds.has(candidateId) ? candidateId : null;
    const threadName = threadId ? null : (trimmed(share.threadName) || fallbackName);
    const key = threadId
      ? `id:${threadId}`
      : `name:${threadName!.normalize("NFC").toLocaleLowerCase()}`;
    const existing = byDestination.get(key);
    if (existing !== undefined) {
      const current = shares[existing];
      current.text = `${current.text}\n\n${text}`;
      current.sourceIndexes.add(sourceIndex);
      destinationForSource.set(sourceIndex, existing);
      return;
    }
    const index = shares.length;
    shares.push({ text, threadId, threadName, sourceIndexes: new Set([sourceIndex]) });
    byDestination.set(key, index);
    destinationForSource.set(sourceIndex, index);
  });

  return { shares, destinationForSource };
}

/** Exact source ownership: every semantic piece owns one contiguous span,
    spans never overlap, and no non-whitespace source character is unowned.

    Complete coverage lets this be a bounded left-to-right interval match
    rather than a permutation search. Equal repeated pieces share one counter;
    distinct prefix collisions choose the longest interval deterministically.
    A wrong deterministic choice can only reject the decomposition at the
    final coverage check — it can never make incomplete output look valid. */
function validateSourcePartition(clean: string, pieces: string[]): void {
  if (!clean.trim() || !pieces.length || pieces.some((piece) => !piece.trim())) {
    throw new UnsafeSortInterpretationError();
  }
  const significant = (value: string) => {
    let count = 0;
    for (const character of value) if (!/\s/u.test(character)) count++;
    return count;
  };
  if (pieces.reduce((total, piece) => total + significant(piece), 0) !== significant(clean)) {
    throw new UnsafeSortInterpretationError();
  }

  const remaining = new Map<string, number>();
  for (const piece of pieces) remaining.set(piece, (remaining.get(piece) ?? 0) + 1);
  let cursor = 0;
  let matched = 0;
  while (matched < pieces.length) {
    while (cursor < clean.length && /\s/u.test(clean[cursor])) cursor++;
    if (cursor >= clean.length) throw new UnsafeSortInterpretationError();

    let candidate: string | null = null;
    for (const [piece, count] of remaining) {
      if (!count || !clean.startsWith(piece, cursor)) continue;
      if (candidate === null || piece.length > candidate.length ||
          (piece.length === candidate.length && piece < candidate)) {
        candidate = piece;
      }
    }
    if (candidate === null) throw new UnsafeSortInterpretationError();
    remaining.set(candidate, remaining.get(candidate)! - 1);
    cursor += candidate.length;
    matched++;
  }

  while (cursor < clean.length && /\s/u.test(clean[cursor])) cursor++;
  if (cursor !== clean.length || [...remaining.values()].some((count) => count !== 0)) {
    throw new UnsafeSortInterpretationError();
  }
}

function actionMetadata(actions: NormalizedAction[]) {
  return actions.map((action) => ({
    text: action.text,
    source: action.source,
    shelfLife: action.shelfLife,
    due: action.due,
    thinkingIndex: action.thinkingIndex,
  }));
}

function threadResult(
  value: SortInterpretation,
  thinking: NormalizedThinking[],
  actions: NormalizedAction[],
  imageDestination: number | null,
): SortResult {
  const primary = thinking[0];
  const also = thinking.slice(1).map((share, offset) => {
    const destination = offset + 1;
    const related = actions
      .filter((action) => action.thinkingIndex === destination)
      .map((action) => action.text);
    return {
      text: share.text,
      threadId: share.threadId,
      threadName: share.threadName,
      actions: related.length ? related : null,
      ownsImages: imageDestination === destination,
    };
  });
  const actionTexts = actions.map((action) => action.text);
  const primaryActions = actions
    .filter((action) => action.thinkingIndex === 0)
    .map((action) => action.text);
  const kind = actionTexts.length ? "both" : "thread";

  return {
    clean: value.clean.trim(),
    kind,
    title: boundedTitle(value.title),
    actions: actionTexts,
    actionMeta: actionMetadata(actions),
    primaryActions: primaryActions.length ? primaryActions : null,
    shelfLife: value.shelfLife,
    due: actionTexts.length === 1 ? actions[0].due : null,
    threadId: primary.threadId,
    threadName: primary.threadName,
    primaryText: thinking.length > 1 || kind === "both" ? primary.text : null,
    primaryOwnsImages: imageDestination === 0,
    also: also.length ? also : null,
  };
}

function actionResult(
  value: SortInterpretation,
  clean: string,
  title: string,
  actions: NormalizedAction[],
  ownsImages: boolean,
): SortResult {
  const selected = actions.length ? actions : [{
    text: clean,
    source: clean,
    thinkingIndex: null,
    shelfLife: value.shelfLife,
    due: value.due,
  }];
  return {
    clean,
    kind: "action",
    title,
    actions: selected.map((action) => action.text),
    actionMeta: actionMetadata(selected),
    primaryActions: null,
    shelfLife: value.shelfLife,
    due: selected.length === 1 ? selected[0].due : null,
    threadId: null,
    threadName: null,
    primaryText: null,
    primaryOwnsImages: ownsImages,
    also: null,
  };
}

export function interpretationToSortResult(
  value: SortInterpretation,
  options: Options,
): SortResult {
  const clean = value.clean.trim() || options.fallbackText?.trim() || value.title.trim();
  const title = boundedTitle(value.title.trim() || clean);
  const normalized = { ...value, clean, title };
  const validThreadIds = new Set(options.validThreadIds);
  const normalizedThinking = normalizeThinking(value.thinking, validThreadIds, title);
  const thinking = normalizedThinking.shares;
  let actions = normalizeActions(value.actions, value).map((action) => ({
    ...action,
    thinkingIndex: action.thinkingIndex !== null && Number.isInteger(action.thinkingIndex)
      ? (normalizedThinking.destinationForSource.get(action.thinkingIndex) ?? null)
      : null,
  }));

  const strictPartition = options.requireCompleteSource || value.actions.some((action) => action.sourceText !== undefined);

  if (options.force === "thread") {
    const destination = thinking[0] ?? {
      text: clean,
      threadId: null,
      threadName: title,
      sourceIndexes: new Set([0]),
    };
    return threadResult(normalized, [{ ...destination, text: clean }], [], options.hasImage ? 0 : null);
  }

  if (options.force === "action") {
    if (strictPartition && actions.length) {
      try {
        validateSourcePartition(clean, actions.map((action) => action.source));
      } catch {
        actions = [];
      }
    }
    return actionResult(normalized, normalized.clean, title, actions, !!options.hasImage);
  }

  if (options.force === "intention") {
    return {
      clean: normalized.clean,
      kind: "intention",
      title,
      actions: [],
      actionMeta: [],
      primaryActions: null,
      shelfLife: value.shelfLife,
      due: null,
      threadId: null,
      threadName: null,
      primaryText: null,
      primaryOwnsImages: false,
      also: null,
    };
  }

  if (strictPartition) {
    if (thinking.length || actions.length) {
      validateSourcePartition(clean, [
        ...value.thinking.map((share) => share.text.trim()).filter(Boolean),
        ...actions.map((action) => action.source),
      ]);
    } else if (!trimmed(value.intention)) {
      throw new UnsafeSortInterpretationError();
    }
  }

  let imageDestination: number | null = null;
  if (options.hasImage && thinking.length) {
    const sourceIndex = value.imageThinkingIndex;
    if (sourceIndex === null || sourceIndex === undefined || !Number.isInteger(sourceIndex)) {
      throw new UnsafeSortInterpretationError("The image has no semantic owner.");
    }
    const destination = normalizedThinking.destinationForSource.get(sourceIndex);
    if (destination === undefined) throw new UnsafeSortInterpretationError("The image owner is invalid.");
    imageDestination = destination;
  }

  if (thinking.length) return threadResult(normalized, thinking, actions, imageDestination);
  if (actions.length) return actionResult(normalized, normalized.clean, title, actions, !!options.hasImage);

  if (trimmed(value.intention)) {
    return {
      clean: normalized.clean,
      kind: "intention",
      title,
      actions: [],
      actionMeta: [],
      primaryActions: null,
      shelfLife: value.shelfLife,
      due: null,
      threadId: null,
      threadName: null,
      primaryText: null,
      primaryOwnsImages: false,
      also: null,
    };
  }

  if (options.requireCompleteSource) throw new UnsafeSortInterpretationError();
  return threadResult(normalized, [{
    text: normalized.clean,
    threadId: null,
    threadName: title,
    sourceIndexes: new Set([0]),
  }], [], options.hasImage ? 0 : null);
}
