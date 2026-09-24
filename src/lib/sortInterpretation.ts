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

export type SourceSegment = {
  /** Exact next characters from `clean`; segments are ordered and exhaustive. */
  text: string;
  role: "thinking" | "action" | "intention" | "context";
  /** Index into the matching semantic array; context has no semantic owner. */
  ownerIndex: number | null;
  /** Action indexes that explicitly own shared context such as a deadline. */
  actionOwnerIndexes?: number[] | null;
};

export type SortInterpretation = {
  clean: string;
  title: string;
  thinking: ThinkingShare[];
  actions: InterpretedAction[];
  sourceSegments?: SourceSegment[];
  intention: string | null;
  /** The thinking share whose fragment owns attached image bytes. */
  imageThinkingIndex?: number | null;
  /** Legacy scalar defaults retained for older local fixtures. New route output
      carries these values on each action. */
  shelfLife: "hours" | "days" | "weeks" | "keep";
  due: string | null;
};

export type SemanticSegment = {
  role: "context" | "thinking" | "action" | "intention";
  source: string;
  threadId: string | null;
  threadName: string | null;
  ownsImage: boolean | null;
  action: string | null;
  thinkingOrdinal: number | null;
  intention: string | null;
  actionOrdinals: number[] | null;
  shelfLife: "hours" | "days" | "weeks" | "keep" | null;
  due: string | null;
};

type SemanticSegmentInput = Pick<SemanticSegment, "role" | "source"> &
  Partial<Omit<SemanticSegment, "role" | "source">>;

export type SemanticInterpretation = {
  title: string;
  segments: SemanticSegmentInput[];
};

/** Derive Capture's stable internal contract from one model-owned sequence. */
export function semanticSegmentsToInterpretation(
  value: SemanticInterpretation,
): SortInterpretation {
  const segments: SemanticSegment[] = value.segments.map((segment) => ({
    threadId: null,
    threadName: null,
    ownsImage: null,
    action: null,
    thinkingOrdinal: null,
    intention: null,
    actionOrdinals: null,
    shelfLife: null,
    due: null,
    ...segment,
  }));
  if (!segments.length || segments.length > 256) {
    throw new UnsafeSortInterpretationError();
  }
  if (segments.some((segment) => !segment.source)) {
    throw new UnsafeSortInterpretationError();
  }
  /* The model already decided the semantic blocks. Rendering a blank line
     between those blocks is mechanical formatting, not another meaning pass.
     Existing blank lines are retained and immutable raw remains in the Record. */
  const formattedSources: string[] = [];
  let seenSemantic = false;
  for (const segment of segments) {
    let source = segment.source;
    if (
      segment.role !== "context" &&
      seenSemantic &&
      !formattedSources.join("").endsWith("\n\n") &&
      !source.startsWith("\n\n")
    ) {
      const previousIndex = formattedSources.length - 1;
      formattedSources[previousIndex] = formattedSources[previousIndex].replace(/[\t ]+$/u, "");
      source = `\n\n${source.replace(/^[\t ]+/u, "")}`;
    }
    formattedSources.push(source);
    if (segment.role !== "context") seenSemantic = true;
  }
  const clean = formattedSources.join("");
  if (!clean.trim()) throw new UnsafeSortInterpretationError();

  /* The provider schema uses one flat object shape because strict structured
     output models handle it more reliably than a union of role-specific
     objects. The role is authoritative: fields belonging to another role are
     ignored rather than treated as semantic evidence or as a reason to reject
     otherwise complete output. Required fields for the selected role are
     still validated below, and exact ordered source coverage remains strict. */

  const thinkingSegments = segments.filter((segment) => segment.role === "thinking");
  const actionSegments = segments.filter((segment) => segment.role === "action");
  const intentionSegments = segments.filter((segment) => segment.role === "intention");
  if (thinkingSegments.length > 12 || actionSegments.length > 32) {
    throw new UnsafeSortInterpretationError("The semantic decomposition exceeds its bound.");
  }
  if (!thinkingSegments.length && !actionSegments.length && !intentionSegments.length) {
    throw new UnsafeSortInterpretationError("The interpretation has no semantic item.");
  }
  if (intentionSegments.length && (intentionSegments.length !== 1 || segments.length !== 1)) {
    throw new UnsafeSortInterpretationError("An intention cannot coexist with other segments.");
  }

  const actions: InterpretedAction[] = actionSegments.map((segment) => {
    if (!segment.action?.trim() || segment.shelfLife === null) {
      throw new UnsafeSortInterpretationError("An action segment is incomplete.");
    }
    const requestedThinkingIndex = segment.thinkingOrdinal === null
      ? null
      : segment.thinkingOrdinal - 1;
    /* This pointer is optional relationship metadata, not semantic content.
       A model can preserve the complete action yet reference a nonexistent
       thinking ordinal. Dropping that invalid association is safer than
       rejecting the whole capture; it cannot invent, omit, or reroute text. */
    const thinkingIndex = requestedThinkingIndex !== null &&
      Number.isInteger(requestedThinkingIndex) &&
      requestedThinkingIndex >= 0 &&
      requestedThinkingIndex < thinkingSegments.length
      ? requestedThinkingIndex
      : null;
    return {
      text: segment.action,
      sourceText: segment.source,
      thinkingIndex,
      shelfLife: segment.shelfLife,
      due: segment.due,
    };
  });

  const sourceSegments: SourceSegment[] = [];
  let thinkingIndex = 0;
  let actionIndex = 0;
  let intentionIndex = 0;
  for (const [segmentIndex, segment] of segments.entries()) {
    const formattedSource = formattedSources[segmentIndex];
    if (segment.role === "context") {
      if (!formattedSource) continue;
      const indexes = (segment.actionOrdinals ?? []).map((ordinal) => ordinal - 1);
      if (
        new Set(indexes).size !== indexes.length ||
        indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= actions.length) ||
        ((segment.shelfLife !== null || segment.due !== null) && !indexes.length) ||
        (segment.shelfLife === null && segment.due === null && indexes.length)
      ) {
        throw new UnsafeSortInterpretationError("Shared context has invalid action owners.");
      }
      for (const index of indexes) {
        const action = actions[index];
        if (segment.due !== null && action.due !== null && action.due !== segment.due) {
          throw new UnsafeSortInterpretationError("Shared and action deadlines conflict.");
        }
        if (segment.shelfLife !== null) action.shelfLife = segment.shelfLife;
        if (segment.due !== null) action.due = segment.due;
      }
      sourceSegments.push({
        text: formattedSource,
        role: "context",
        ownerIndex: null,
        actionOwnerIndexes: indexes.length ? indexes : null,
      });
      continue;
    }
    if (segment.role === "thinking") {
      sourceSegments.push({ text: formattedSource, role: "thinking", ownerIndex: thinkingIndex });
      thinkingIndex += 1;
      continue;
    }
    if (segment.role === "action") {
      sourceSegments.push({ text: formattedSource, role: "action", ownerIndex: actionIndex });
      actionIndex += 1;
      continue;
    }
    sourceSegments.push({ text: formattedSource, role: "intention", ownerIndex: intentionIndex });
    intentionIndex += 1;
  }

  if (thinkingSegments.some((segment) => segment.ownsImage === null)) {
    throw new UnsafeSortInterpretationError("Thinking image ownership is incomplete.");
  }
  if (intentionSegments.some((segment) => !segment.intention?.trim())) {
    throw new UnsafeSortInterpretationError("The intention is incomplete.");
  }
  const imageOwners = thinkingSegments
    .map((segment, index) => segment.ownsImage ? index : -1)
    .filter((index) => index >= 0);
  if (imageOwners.length > 1) {
    throw new UnsafeSortInterpretationError("The image has several semantic owners.");
  }
  const soleAction = actions.length === 1 ? actions[0] : null;
  return {
    clean,
    title: value.title,
    thinking: thinkingSegments.map((segment) => ({
      text: segment.source,
      threadId: segment.threadId,
      threadName: segment.threadName,
    })),
    actions,
    sourceSegments,
    intention: intentionSegments[0]?.intention ?? null,
    imageThinkingIndex: imageOwners[0] ?? null,
    shelfLife: soleAction?.shelfLife ?? "keep",
    due: soleAction?.due ?? null,
  };
}

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

type SourcePiece = { key: string; anchor: string };
type SourceMatch = SourcePiece & { start: number; end: number };

/**
 * Every semantic owner must explicitly claim its complete contiguous source
 * span. The spans may be returned in any order, but each exact span must occur
 * once, spans may not overlap, and only whitespace may sit between them.
 *
 * Capture deliberately does not infer ownership for omitted words. Doing so
 * could hide a second action or subject inside an adjacent owner while still
 * appearing character-lossless. Repeated exact spans are also ambiguous and
 * fail closed. The check is bounded and deterministic; it never searches
 * permutations or applies language-specific connective rules.
 */
function assignSourceOwnership(clean: string, pieces: SourcePiece[]): Map<string, string> {
  if (!clean.trim() || !pieces.length || pieces.some((piece) => !piece.anchor.trim())) {
    throw new UnsafeSortInterpretationError();
  }
  if (pieces.length > 256 || new Set(pieces.map((piece) => piece.key)).size !== pieces.length) {
    throw new UnsafeSortInterpretationError();
  }

  const matches: SourceMatch[] = [];
  for (const sourcePiece of pieces) {
    const piece = { ...sourcePiece, anchor: sourcePiece.anchor.trim() };
    const start = clean.indexOf(piece.anchor);
    if (start < 0 || clean.indexOf(piece.anchor, start + 1) >= 0) {
      throw new UnsafeSortInterpretationError();
    }
    const end = start + piece.anchor.length;
    if (matches.some((span) => start < span.end && end > span.start)) {
      throw new UnsafeSortInterpretationError();
    }
    matches.push({ ...piece, start, end });
  }

  matches.sort((left, right) => left.start - right.start || left.end - right.end);
  const ownership = new Map<string, string>();
  let cursor = 0;
  for (const match of matches) {
    if (clean.slice(cursor, match.start).trim()) {
      throw new UnsafeSortInterpretationError();
    }
    ownership.set(match.key, clean.slice(match.start, match.end));
    cursor = match.end;
  }
  if (clean.slice(cursor).trim()) throw new UnsafeSortInterpretationError();
  return ownership;
}

function assignOrderedSourceSegments(
  clean: string,
  segments: SourceSegment[],
  thinking: ThinkingShare[],
  actions: NormalizedAction[],
  intention: string | null,
): Map<string, string> {
  /* This validator proves only mechanical integrity: ordered exact spans,
     bounded references, and exactly one segment for every semantic owner.
     It cannot semantically prove that a provider mislabeled meaningful text
     as context. Real-provider adversarial cases own that model-level claim;
     adding vocabulary or punctuation checks here would be a lexical override. */
  if (!segments.length || segments.length > 256) {
    throw new UnsafeSortInterpretationError();
  }

  /* Providers sometimes omit only formatting whitespace inserted into clean.
     Preserve clean verbatim, but never infer ownership for non-whitespace.
     Ordered exact spans remove the repeated-text ambiguity of anchor search. */
  let cursor = 0;
  for (const segment of segments) {
    if (!segment.text) throw new UnsafeSortInterpretationError();
    const start = clean.indexOf(segment.text, cursor);
    if (start < cursor || clean.slice(cursor, start).trim()) {
      throw new UnsafeSortInterpretationError();
    }
    cursor = start + segment.text.length;
  }
  if (clean.slice(cursor).trim()) throw new UnsafeSortInterpretationError();

  const ownership = new Map<string, string>();
  const nextOwnerIndex = { thinking: 0, action: 0, intention: 0 };
  for (const segment of segments) {
    if (segment.role === "context") {
      if (segment.ownerIndex !== null) throw new UnsafeSortInterpretationError();
      const actionOwners = segment.actionOwnerIndexes ?? [];
      if (
        actionOwners.length > actions.length ||
        new Set(actionOwners).size !== actionOwners.length ||
        actionOwners.some((index) => !Number.isInteger(index) || index < 0 || index >= actions.length)
      ) {
        throw new UnsafeSortInterpretationError();
      }
      continue;
    }
    if (segment.actionOwnerIndexes !== undefined && segment.actionOwnerIndexes !== null) {
      throw new UnsafeSortInterpretationError();
    }
    if (!segment.text.trim() || !Number.isInteger(segment.ownerIndex)) {
      throw new UnsafeSortInterpretationError();
    }
    /* Provider index conventions vary (zero-based, one-based, or global
       semantic order). Ordered role occurrences are the stable mechanical
       contract: the first action span belongs to actions[0], and so on. */
    const ownerIndex = nextOwnerIndex[segment.role];
    nextOwnerIndex[segment.role] += 1;
    const ownerCount = segment.role === "thinking"
      ? thinking.length
      : segment.role === "action"
        ? actions.length
        : (intention?.trim() ? 1 : 0);
    if (ownerIndex < 0 || ownerIndex >= ownerCount) throw new UnsafeSortInterpretationError();
    const key = `${segment.role}:${ownerIndex}`;
    if (ownership.has(key)) throw new UnsafeSortInterpretationError();
    ownership.set(key, segment.text);
  }

  thinking.forEach((share, index) => {
    if (share.text.trim() && !ownership.has(`thinking:${index}`)) throw new UnsafeSortInterpretationError();
  });
  actions.forEach((_action, index) => {
    if (!ownership.has(`action:${index}`)) throw new UnsafeSortInterpretationError();
  });
  if (intention?.trim() && !ownership.has("intention:0")) throw new UnsafeSortInterpretationError();
  return ownership;
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
    clean: value.clean,
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
  // The route schema is tighter, but keep the pure boundary bounded for
  // replayed fixtures and callers that construct interpretations directly.
  if (value.thinking.length + value.actions.length > 64) {
    throw new UnsafeSortInterpretationError();
  }
  if (
    !options.force &&
    trimmed(value.intention) &&
    (value.thinking.some((share) => share.text.trim()) || value.actions.some((action) => action.text.trim()))
  ) {
    // Intention is an exclusive semantic interpretation. Reject conflicting
    // provider evidence before normalization can choose thinking/actions and
    // silently discard the intention. Explicit user-forced kinds remain
    // authoritative below.
    throw new UnsafeSortInterpretationError("An intention cannot coexist with thinking or actions.");
  }
  const clean = value.sourceSegments?.length && value.clean.trim()
    ? value.clean
    : value.clean.trim() || options.fallbackText?.trim() || value.title.trim();
  const title = boundedTitle(value.title.trim() || clean);
  const normalized = { ...value, clean, title };
  const validThreadIds = new Set(options.validThreadIds);
  let actions = normalizeActions(value.actions, value).map((action) => ({
    ...action,
  }));
  const strictPartition = options.requireCompleteSource || value.sourceSegments !== undefined || value.actions.some((action) => action.sourceText !== undefined);
  let ownedThinking = value.thinking;
  let orderedPartitionAssigned = false;

  if ((value.sourceSegments && options.force !== "thread" && options.force !== "intention") ||
      (strictPartition && !options.force && (ownedThinking.some((share) => share.text.trim()) || actions.length))) {
    let ownership: Map<string, string>;
    try {
      ownership = value.sourceSegments
        ? assignOrderedSourceSegments(clean, value.sourceSegments, ownedThinking, actions, value.intention)
        : assignSourceOwnership(clean, [
          ...ownedThinking.flatMap((share, index) => share.text.trim()
            ? [{ key: `thinking:${index}`, anchor: share.text }]
            : []),
          ...actions.map((action, index) => ({ key: `action:${index}`, anchor: action.source })),
        ]);
      orderedPartitionAssigned = value.sourceSegments !== undefined;
    } catch (error) {
      if (options.force !== "action") throw error;
      actions = [];
      ownership = new Map();
    }
    ownedThinking = ownedThinking.map((share, index) => share.text.trim()
      ? { ...share, text: ownership.get(`thinking:${index}`)?.trim() ?? share.text }
      : share);
    actions = actions.map((action, index) => ({
      ...action,
      source: ownership.get(`action:${index}`)!.trim(),
    }));
  }

  const normalizedThinking = normalizeThinking(ownedThinking, validThreadIds, title);
  const thinking = normalizedThinking.shares;
  actions = actions.map((action) => ({
    ...action,
    thinkingIndex: action.thinkingIndex !== null && Number.isInteger(action.thinkingIndex)
      ? (normalizedThinking.destinationForSource.get(action.thinkingIndex) ?? null)
      : null,
  }));

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
    if (strictPartition && actions.length && !orderedPartitionAssigned) {
      try {
        const ownership = assignSourceOwnership(clean, actions.map((action, index) => ({
          key: `action:${index}`,
          anchor: action.source,
        })));
        actions = actions.map((action, index) => ({
          ...action,
          source: ownership.get(`action:${index}`)!.trim(),
        }));
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

  if (strictPartition && !thinking.length && !actions.length && !trimmed(value.intention)) {
    throw new UnsafeSortInterpretationError();
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
