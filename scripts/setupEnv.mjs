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
function setApiKey(content, name, key) {
  const newLine = `${name}=${key}`;
  const lines = content.split("\n");
  let replaced = false;
  const out = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    const isActive = trimmed.startsWith(`${name}=`) && !trimmed.startsWith("#");
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

export function setGroqKey(content, key) {
  return setApiKey(content, "GROQ_API_KEY", key);
}

export function setCerebrasKey(content, key) {
  return setApiKey(content, "CEREBRAS_API_KEY", key);
}

export function isOpenRouterModelSlug(model) {
  const decisionsOnly = new Set([
    "typesafe/jev-1.13",
    "~typesafe/jev-latest",
  ]);
  return /^[^\s/]+\/[^\s]+$/.test(model) && !decisionsOnly.has(model);
}

export function setOpenRouterConfig(content, key, model) {
  let updated = setApiKey(content, "OPENROUTER_API_KEY", key);
  updated = setApiKey(updated, "OPENROUTER_MODEL", model);
  return setApiKey(updated, "CAPTURE_MODEL_PROVIDER", "openrouter");
}

/**
 * Status message returned after writing — never mentions the key or a prefix.
 */
export function successMessage(filePath) {
  return `Written to ${filePath}. Run: npm run dev`;
}
