import { commandRule } from "./refiled";

/**
 * Destination commands on the front of a capture.
 *
 * Typed, the form is the usual slash command: "/action pick up milk".
 * Spoken, the recogniser never reliably produces a slash — saying
 * "slash action" usually transcribes as the words, and the natural
 * spoken command is the kind word with a period or colon after it.
 * All three forms are accepted so the same habit works whether you
 * type or dictate:
 *
 *   /action …        action. …        slash action …
 *   /thread …        thread: …        slash thread …
 *   /intention …     intention. …     slash intention …
 *
 * The command is stripped and the rest is returned as the payload.
 * A bare leading kind word with no punctuation ("action items for
 * tomorrow") is NOT a command — punctuation is what marks the
 * command, so ordinary speech starting with the word is left for the
 * sorting model to decide.
 */

export type ForceKind = "action" | "thread" | "intention";

const KINDS = "action|thread|intention";

/* One regex, three alternatives: the typed slash, the dictated "slash X",
   and the kind word closed by a period or colon. */
const COMMAND = new RegExp(
  `^\\/(${KINDS})\\b|^slash\\s+(${KINDS})\\b|^(${KINDS})\\s*[.:]`,
  "i"
);

export function parseCommandPrefix(raw: string): {
  force: ForceKind | undefined;
  payload: string;
} {
  const m = raw.match(COMMAND);
  if (!m) return { force: undefined, payload: raw };
  const kind = (m[1] || m[2] || m[3] || "").toLowerCase() as ForceKind;
  /* The "slash X" form may be followed by stray punctuation ("slash
     action: send it"); strip any leading punctuation off the payload. */
  const payload = raw.slice(m[0].length).replace(/^[.:\s]+/, "");
  return { force: kind, payload };
}

/**
 * Resolve everything a capture's opening decides, in one place.
 *
 * Two precedence rules live here, each with an incident behind it:
 *
 *   - A kind chosen after an undo OUTRANKS a typed prefix. The person has
 *     just been asked the question outright and answered it; the prefix
 *     was written before the question existed.
 *   - Only a TYPED command teaches. A re-sort after undo has already
 *     written its own, stronger lesson — recording both counted one
 *     correction twice, and the personal model weighed the same answer
 *     double.
 */
export type ResolvedCapture = {
  payload: string;
  force: ForceKind | undefined;
  /** The lesson the typed command teaches, or null. */
  commandLesson: string | null;
};

export function resolveCapture(
  raw: string,
  pinned?: ForceKind
): ResolvedCapture {
  const { force: typed, payload } = parseCommandPrefix(raw);
  return {
    payload,
    force: pinned ?? typed,
    commandLesson: !pinned && typed ? commandRule(payload, typed) : null,
  };
}
