/**
 * Pure env-file transformation logic for the setup wizard.
 *
 * No I/O, no side-effects — only string transformations so this module is
 * testable without touching the filesystem or a terminal.
 */

/**
 * Add or replace the active GROQ_API_KEY= line in an env file's text.
 *
 * Rules:
 *  - An "active" line is one that is NOT commented out (does not start with #
 *    after optional whitespace).
 *  - Commented-out examples (# GROQ_API_KEY=) are preserved intact.
 *  - When an active line exists it is replaced; when none exists the new line
 *    is appended at the end.
 *  - Duplicate active lines (unusual but possible after manual edits) are
 *    collapsed: the first is replaced, the rest removed.
 *  - The key value is never included in any returned status string.
 */
export function setGroqKey(content, key) {
  const newLine = `GROQ_API_KEY=${key}`;
  const lines = content.split("\n");
  let replaced = false;
  const out = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    const isActive =
      trimmed.startsWith("GROQ_API_KEY=") && !line.trimStart().startsWith("#");
    if (isActive) {
      if (!replaced) {
        out.push(newLine);
        replaced = true;
      }
      /* Drop any subsequent active duplicates. */
    } else {
      out.push(line);
    }
  }
  if (!replaced) {
    /* Append — ensure there is a trailing newline before adding. */
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
    out.push(newLine);
    out.push("");
  }
  return out.join("\n");
}

/**
 * Status message returned after writing — never mentions the key or a prefix.
 */
export function successMessage(filePath) {
  return `Written to ${filePath}. Run: npm run dev`;
}
