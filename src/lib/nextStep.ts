/**
 * A thread's next step.
 *
 * The summary prompt already reads a whole thread and says what is settled
 * and what is open. The one thing it did not do was name the move: given
 * where this stands, what is the next concrete thing to do. So the same
 * call now ends with one line, NEXT: …, and that line is this.
 *
 * Most threads should have none. A thread of thinking-out-loud has no
 * obvious next move, and inventing one would be clutter of exactly the
 * kind the board is built to avoid; the prompt says to write "none"
 * unless the fragments make the step plain, and the parser treats
 * anything vague the same way.
 */

const NONE = /^(none|nothing|n\/a|-|—|null)?\.?$/i;

/** Split the model's reply into the prose and the step, if any. */
export function splitNext(text: string): {
  summary: string;
  next: string | null;
} {
  const lines = text.trim().split("\n");
  const last = lines[lines.length - 1]?.trim() ?? "";
  const m = /^\**\s*next\s*:\**\s*(.*)$/i.exec(last);
  if (!m) return { summary: text.trim(), next: null };
  const summary = lines.slice(0, -1).join("\n").trim();
  let step = m[1].trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  if (!step || NONE.test(step)) return { summary, next: null };
  /* A step is one thing to do, not a paragraph. */
  if (step.length > 160) step = step.slice(0, 157).replace(/\s+\S*$/, "") + "…";
  return { summary, next: step };
}
