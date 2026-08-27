/**
 * Vision captioning for the sort engine (Sprint 5 — image-aware share).
 *
 * The sorter used to be blind: an image-only capture sorted as the literal
 * string "(image only)". Now, when a capture carries a photo, the sort route
 * first asks a vision-capable tier to describe it in one plain sentence, then
 * sorts the capture with that description in hand — so a photo of a coffee
 * machine files under the coffee thread instead of becoming a mystery.
 *
 * The caption is a bonus layer, never a gate: if no vision tier is
 * configured, or the caption call fails, the sort proceeds exactly as
 * before. Images only ever reach a model when the user attached one.
 */

/** The one-sentence ask. Kept deliberately small and terse — the cheap tiers
    that answer it also answer best with a tight instruction. */
export function captionPrompt(): string {
  return (
    "Describe this photo in one plain sentence for a notes app — what it shows, " +
    "and anything in it that looks like a task, a decision, or a subject to " +
    "keep thinking about. No markdown, no commentary."
  );
}

/** Fold a successful caption into the raw capture text. The sorter's
    "(image only)" placeholder is replaced outright; real text gets the photo
    as an attached note. */
export function mergeCaption(raw: string, caption: string): string {
  const clean = caption.trim().replace(/\s+/g, " ");
  if (!clean) return raw;
  if (!raw.trim() || raw.trim() === "(image only)") return `Photo: ${clean}`;
  return `${raw}\n\n(Attached photo: ${clean})`;
}

/** Trim a model's caption to something the sorter can carry without padding
    the prompt — a sentence, not an essay. */
export function tidyCaption(text: string): string | null {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  return t.slice(0, 300);
}

/**
 * The text with any attached-photo caption taken back off.
 *
 * A caption is a model describing a picture, and it is folded into the
 * fragment so the sorter can file a photo by what it shows. That is right
 * at capture time and wrong everywhere afterwards: photograph a bug on
 * your own board and the caption quotes every item visible in the shot,
 * so the thread you file it in ends up literally containing other
 * actions' text — and the matcher then links them. That is how "Give the
 * caul lilies to my girlfriend" came to sit under "Bugs, Issues and
 * Additions": the bug report was a screenshot of the board saying so.
 *
 * Matching asks what the PERSON said. Search and reading still see the
 * whole thing, caption included.
 */
export function spokenText(s: string): string {
  return (s || "")
    .replace(/\n*\(Attached photo:[^)]*\)/g, "")
    .trim();
}
