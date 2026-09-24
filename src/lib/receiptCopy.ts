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
      lines.push(`New thread: ${part}`);
      index += 1;
      continue;
    }
    if (next === "a new layer") {
      lines.push(`Added to thread: ${part}`);
      index += 1;
      continue;
    }
    if (part.startsWith("a new thread — ")) {
      lines.push(`New thread: ${part.slice("a new thread — ".length)}`);
      continue;
    }
    if (part.startsWith("a layer on ")) {
      lines.push(`Added to thread: ${part.slice("a layer on ".length)}`);
      continue;
    }
    if (part.startsWith("picture kept in ")) {
      lines.push(`Picture saved in: ${part.slice("picture kept in ".length)}`);
      continue;
    }
    if (part === "kept") continue;
    if (part.startsWith("fades in ")) {
      lines.push(`Available for ${part.slice("fades in ".length)}`);
      continue;
    }
    if (part === "Actions, unsorted — sort it when the model is back") {
      lines.push("Actions — waiting to be sorted");
      continue;
    }
    if (/^\d+ actions?$/u.test(part)) {
      lines.push(part[0].toUpperCase() + part.slice(1));
      continue;
    }
    if (/^Intention \d+$/u.test(part)) {
      lines.push(part);
      continue;
    }
    lines.push(`Thread: ${part}`);
  }

  return lines.length ? lines : [receipt];
}
