/*
 * Point the mobile suite at a deployment instead of a local hub.
 *
 *   node scripts/lab-manifest.mjs <base-url> <backup.json> <out.yaml>
 *
 * The suite was written against a local Capture with its own SYNC_DATA_DIR:
 * a seed command wrote a board into that directory and the app read it back.
 * Nothing about that works against Vercel, where the hub is Redis and there
 * is no filesystem to seed — which is why every recording until now ran on
 * localhost, and why two features that die at Vercel's sixty-second ceiling
 * passed every test we had.
 *
 * So seed the other end instead. The board is local-first: the app reads it
 * from IndexedDB and only later reconciles with a hub. Writing the board
 * straight into IndexedDB before the app boots gives the same starting
 * position on ANY host, with no server involvement at all.
 *
 * The deployment this runs against is deployed with a deliberately dead hub,
 * so /api/sync answers 503, the poller backs off, and everything the suite
 * does stays inside the browser profile. That is the safety property that
 * matters: the suite captures, ticks, renames and MOVES notes between
 * threads, and production shares one hub with no pairing — pointed at the
 * real deployment it would merge all of that into a real board.
 *
 * Photos are stripped rather than seeded: their bytes live behind /api/img,
 * which the dead hub cannot answer, so every reference would be a console
 * error and a failed check about nothing.
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "/Users/glebbogachev/Documents/Retake/node_modules/yaml/dist/index.js";

const [, , base, backupPath, out] = process.argv;
if (!base || !backupPath || !out) {
  console.error("usage: node scripts/lab-manifest.mjs <base-url> <backup.json> <out.yaml>");
  process.exit(1);
}
const url = base.replace(/\/$/, "") + "/";

const SRC = path.join(
  process.env.RETAKE_DIR || `${process.env.HOME}/Documents/Retake`,
  "demos/capture-mobile-suite.yaml"
);
const doc = YAML.parse(fs.readFileSync(SRC, "utf8"));

/* The board, without anything that points at bytes the hub would have to
   serve. */
const raw = JSON.parse(fs.readFileSync(backupPath, "utf8"));
const board = raw.board ?? raw;
let covers = 0;
for (const t of board.threads ?? []) if (t.cover) { delete t.cover; covers += 1; }
const strip = (xs) => { for (const x of xs ?? []) if (x.imgs) delete x.imgs; };
strip(board.actions); strip(board.threads); strip(board.intentions);
for (const t of board.threads ?? []) strip(t.notes);

/* Every URL in the manifest moves to the deployment. */
doc.url = url;
const retarget = (steps) => {
  for (const s of steps ?? []) if (typeof s?.url === "string" && /localhost/.test(s.url)) s.url = url;
};
retarget(doc.setup);
retarget(doc.steps);

/* The seed command has nothing to seed any more. */
delete doc.seed;

/* Put the board where the app looks for it, before the app boots.
 *
 * Two things here are load-bearing, both learned by watching a run hang:
 *
 *   The database is never deleted. The suite's own setup wiped IndexedDB by
 *   name, which works on an empty tab and blocks forever on a live one: the
 *   app is running and holding a connection, so deleteDatabase waits for it,
 *   and every later open() queues behind the wait. Opening at the existing
 *   version and overwriting the one key we care about needs no version
 *   change, so it never blocks. localStorage is cleared instead — it is
 *   synchronous and holds the flags (tour, untangle) that would otherwise
 *   leak between runs.
 *
 *   Nothing here can hang the take. Every path resolves, including the
 *   blocked and error ones, and the whole thing races a timeout. A seed step
 *   that never returns costs a twenty-minute recording and says nothing
 *   about the product.
 *
 * The value is a JSON string, not an object — that is how the app stores it,
 * and an object parses as nothing and yields an empty board. */
const seedStep = {
  action: "evaluate",
  script: `
(async () => {
  const BOARD = ${JSON.stringify(JSON.stringify(board))};
  try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
  const write = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open("capture", 1); } catch (e) { return resolve("open threw"); }
    req.onupgradeneeded = () => {
      try {
        if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
      } catch (e) {}
    };
    req.onblocked = () => resolve("blocked");
    req.onerror = () => resolve("open failed");
    req.onsuccess = () => {
      try {
        const tx = req.result.transaction("kv", "readwrite");
        tx.objectStore("kv").put(BOARD, "capture:data:v1");
        tx.oncomplete = () => resolve("written");
        tx.onerror = () => resolve("write failed");
        tx.onabort = () => resolve("write aborted");
      } catch (e) { resolve("transaction threw"); }
    };
  });
  const timeout = new Promise((r) => setTimeout(() => r("timed out"), 8000));
  return await Promise.race([write, timeout]);
})();
`.trim(),
};

/* Drop the suite's own wipe: it deletes the database by name, which is the
   call that blocks against a live app. The seed above clears what actually
   needs clearing. */
doc.setup = (doc.setup || []).filter(
  (s) => !(typeof s?.script === "string" && s.script.includes("deleteDatabase"))
);

/* Before the navigate that boots the app on the seeded board. */
const nav = doc.setup.findIndex((s) => s?.action === "navigate");
doc.setup.splice(nav < 0 ? 0 : nav, 0, seedStep);

fs.writeFileSync(out, YAML.stringify(doc, { lineWidth: 0 }));
console.log(
  `lab manifest → ${out}\n  host: ${url}\n  board: ${(board.threads || []).length} threads, ` +
  `${(board.actions || []).length} actions, ${(board.ledger || []).length} ledger, ${covers} covers stripped`
);
