#!/usr/bin/env node
/**
 * export:capture — mirror the board into a plain Markdown vault.
 *
 *   npm run export:capture
 *
 * Reads the sync hub (`.data/sync.json` — the one merged copy the Mac
 * keeps, shared with the phone) and writes a readable, agent-friendly
 * tree under `CaptureVault/`:
 *
 *   CaptureVault/
 *     README.md        how the vault is laid out
 *     actions.md       open + faded actions with shelf lives
 *     intentions.md    each intention with what pulls against it
 *     principles.md    the shaping principles, enabled or not
 *     threads/<slug>.md  one file per thread: summary + dated fragments
 *     ledger.json      the raw capture ledger
 *     corrections.json the proposal outcomes — what the user accepted, dismissed, corrected
 *
 * Why Markdown: it is the lingua franca of agents. Hermes, a coding agent,
 * or any tool can answer "what are my active actions, threads and
 * intentions?" from this folder without ever touching the app database.
 *
 * The vault is a snapshot — regenerating overwrites it wholesale.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const HUB_DIR = process.env.SYNC_DATA_DIR || path.join(process.cwd(), ".data");
const HUB = process.env.CAPTURE_HUB || path.join(HUB_DIR, "sync.json");
const OUT = process.env.CAPTURE_VAULT_DIR || path.join(process.cwd(), "CaptureVault");

const day = (at) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? "unknown date"
    : d.toISOString().slice(0, 10);
};

const slugify = (name) =>
  (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "thread";

const load = async () => {
  let raw;
  try {
    raw = await fs.readFile(HUB, "utf8");
  } catch {
    throw new Error(
      `No sync hub found at ${HUB}.\n` +
        "Run the app once and let it sync (the hub is written on the first push), then try again."
    );
  }
  const parsed = JSON.parse(raw);
  const board = parsed.board || {};
  return {
    actions: Array.isArray(board.actions) ? board.actions : [],
    threads: Array.isArray(board.threads) ? board.threads : [],
    intentions: Array.isArray(board.intentions) ? board.intentions : [],
    principles: Array.isArray(board.principles) ? board.principles : [],
    ledger: Array.isArray(board.ledger) ? board.ledger : [],
    corrections: Array.isArray(board.corrections) ? board.corrections : [],
  };
};

const actionsMd = (b) => {
  const open = b.actions.filter((a) => !a.faded);
  const faded = b.actions.filter((a) => a.faded);
  const lines = [`# Actions`, ``, `${open.length} open · ${faded.length} faded`, ``];
  if (!open.length) lines.push(`Nothing to close right now.`, ``);
  for (const a of open) {
    lines.push(
      `- [ ] **${a.text}** — ${day(a.at)} · ${a.shelf || "keep"}` +
        (a.unsorted ? ` · *unsorted*` : ``)
    );
    if (a.src && a.src !== a.text) lines.push(`    - captured as: ${a.src}`);
  }
  if (faded.length) {
    lines.push(``, `## Faded`, ``);
    for (const a of faded)
      lines.push(`- [ ] ${a.text} — ${day(a.at)} · faded ${day(a.fadedAt || a.at)}`);
  }
  return lines.join("\n") + "\n";
};

const intentionsMd = (b) => {
  const lines = [`# Intentions`, ``];
  if (!b.intentions.length) {
    lines.push(`Nothing declared yet.`, ``);
    return lines.join("\n") + "\n";
  }
  for (const i of b.intentions) {
    const n = String(i.number || "").padStart(2, "0");
    lines.push(`## (${n}) ${i.expandedIntention}`, ``);
    if (i.recommendedActions?.length) {
      lines.push(`_Because this is so:_`, ``);
      for (const r of i.recommendedActions) lines.push(`- ${r}`);
      lines.push(``);
    }
    if (i.counterIntentions?.length) {
      lines.push(`_Pulls against:_`, ``);
      for (const c of i.counterIntentions) lines.push(`- ${c}`);
      lines.push(``);
    }
    if (i.rawInput && i.rawInput !== i.expandedIntention)
      lines.push(`> Said: “${i.rawInput}” · ${day(i.at)}`, ``);
  }
  return lines.join("\n") + "\n";
};

const principlesMd = (b) => {
  const lines = [`# Principles`, ``];
  if (!b.principles.length) return lines.join("\n") + "\n";
  for (const p of b.principles) {
    lines.push(`- ${p.enabled ? "" : "~~" }**${p.name}**${p.enabled ? "" : "~~"} — ${p.description}`);
  }
  return lines.join("\n") + "\n";
};

const threadMd = (t) => {
  const lines = [`# ${t.name}`, ``];
  /* The stored summary sometimes already carries the label; don't double it. */
  const summary = (t.summary || "").replace(/^Where this stands:\s*/i, "");
  if (summary) lines.push(`> Where this stands: ${summary}`, ``);
  lines.push(`## Fragments`, ``);
  for (const f of t.frags) {
    lines.push(`### ${day(f.at)}`, ``);
    lines.push(f.text, ``);
    if (f.imgs?.length) lines.push(`_${f.imgs.length} image${f.imgs.length > 1 ? "s" : ""}_`, ``);
    if (f.unsorted) lines.push(`_unsorted_`, ``);
  }
  return lines.join("\n") + "\n";
};

const vaultReadme = (b, threads) => `# Capture vault

Generated by \`npm run export:capture\` — a Markdown mirror of the board.

- \`actions.md\` — things to close (open, then faded).
- \`intentions.md\` — things declared as already true, with what pulls against them.
- \`principles.md\` — the shaping principles (~~struck~~ = disabled).
- \`threads/\` — one file per thread; fragments newest first in each file.
- \`ledger.json\` — the raw capture ledger: what was said, what it became, where it landed.
- \`corrections.json\` — proposal outcomes: every suggestion accepted, dismissed, renamed, or cleaned — the learning signal.

Snapshot from ${threads} threads on ${new Date().toISOString()}.
`;

const main = async () => {
  const b = await load();

  // Thread slugs must be unique — same name twice becomes name, name-2, …
  const used = new Map();
  const pathFor = (t) => {
    const base = slugify(t.name);
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    return `${base}${n === 1 ? "" : "-" + n}.md`;
  };

  const threadsDir = path.join(OUT, "threads");
  await fs.mkdir(threadsDir, { recursive: true });

  await Promise.all([
    fs.writeFile(path.join(OUT, "README.md"), vaultReadme(b, b.threads.length), "utf8"),
    fs.writeFile(path.join(OUT, "actions.md"), actionsMd(b), "utf8"),
    fs.writeFile(path.join(OUT, "intentions.md"), intentionsMd(b), "utf8"),
    fs.writeFile(path.join(OUT, "principles.md"), principlesMd(b), "utf8"),
    fs.writeFile(path.join(OUT, "ledger.json"), JSON.stringify(b.ledger, null, 2) + "\n", "utf8"),
    fs.writeFile(
      path.join(OUT, "corrections.json"),
      JSON.stringify(b.corrections, null, 2) + "\n",
      "utf8"
    ),
    ...b.threads.map((t) =>
      fs.writeFile(path.join(threadsDir, pathFor(t)), threadMd(t), "utf8")
    ),
  ]);

  const frags = b.threads.reduce((n, t) => n + t.frags.length, 0);
  console.log(
    `Exported to ${OUT}\n` +
      `  ${b.actions.length} actions (${b.actions.filter((a) => !a.faded).length} open)\n` +
      `  ${b.threads.length} threads · ${frags} fragments\n` +
      `  ${b.intentions.length} intentions · ${b.principles.length} principles\n` +
      `  ${b.ledger.length} ledger entries · ${b.corrections.length} corrections`
  );
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
