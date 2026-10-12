import { countNoun, t } from "./i18n";

/* Receipts are fixed English tokens: they are stored (manual undo) and
   parsed here. Only what reaches the screen is translated. */
export function receiptLabel(receipt: string): string {
  if (receipt === "Actions") return t("Actions");
  if (receipt === "Intentions") return t("Intentions");
  if (receipt === "Threads") return t("Threads");
  if (receipt === "Split filed") return t("Split filed");
  return receipt;
}

export function receiptLines(receipt: string): string[] {
  const parts = receipt
    .split(" · ")
    .map((part) => part.trim())
    .filter(Boolean);
  const lines: string[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const next = parts[index + 1];

    if (next === "a new thread") {
      lines.push(t("New thread: {name}", { name: part }));
      index += 1;
      continue;
    }
    if (next === "a new layer") {
      lines.push(t("Added to thread: {name}", { name: part }));
      index += 1;
      continue;
    }
    if (part.startsWith("a new thread — ")) {
      lines.push(t("New thread: {name}", { name: part.slice("a new thread — ".length) }));
      continue;
    }
    if (part.startsWith("a layer on ")) {
      lines.push(t("Added to thread: {name}", { name: part.slice("a layer on ".length) }));
      continue;
    }
    if (part.startsWith("picture kept in ")) {
      lines.push(t("Picture saved in: {name}", { name: part.slice("picture kept in ".length) }));
      continue;
    }
    if (part === "kept") continue;
    if (part.startsWith("fades in ")) {
      lines.push(t("Available for {left}", { left: part.slice("fades in ".length) }));
      continue;
    }
    if (part === "Actions, unsorted — sort it when the model is back") {
      lines.push(t("Actions — waiting to be sorted"));
      continue;
    }
    if (/^\d+ actions?$/u.test(part)) {
      const shown = countNoun(parseInt(part, 10), "action");
      lines.push(shown[0].toUpperCase() + shown.slice(1));
      continue;
    }
    if (/^Intention \d+$/u.test(part)) {
      lines.push(part);
      continue;
    }
    lines.push(t("Thread: {name}", { name: part }));
  }

  return lines.length ? lines : [receipt];
}
