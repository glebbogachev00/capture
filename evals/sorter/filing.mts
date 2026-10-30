/**
 * Does the sorter file thoughts where the person would?
 *   npx tsx --conditions=react-server evals/sorter/filing.mts
 * Subscription by default (see tier.ts); CAPTURE_EVAL_ALL=1 for every case;
 * CAPTURE_EVAL_CORRECTIONS=1 adds the correction examples production used to send.
 * Prints "refiled a/b control c/d errors e" and saves results to ~/.capture-eval/results.
 */
import { shouldFormat } from "@/lib/captureFormat";
import { formatCapture } from "@/lib/captureFormat.server";
import { fileThought, fileThoughts } from "@/lib/secondLook.server";
import { generateSimpleSort, normalizeSimpleSort, simpleSortPrompt } from "@/lib/simpleSort";
import { semanticSortContext } from "@/lib/sortContext";
import { boardAt, loadBoard, loadCases, save, type Result } from "./common";
import { announce, evalTier } from "./tier";

const full = loadBoard();
const cases = loadCases("filing-cases.json");
const tier = evalTier();
announce(tier, cases.length);
const out: Result[] = [];
for (const c of cases) {
  try {
    const board = boardAt(full, c);
    const actions = board.actions.filter((a) => !a.unsorted && !a.done && !a.faded).map((a) => ({ id: a.id, text: a.text }));
    const context = semanticSortContext(board, c.raw, [], c.at);
    const raw = shouldFormat(c.raw) ? await formatCapture(c.raw, { tier }).catch(() => c.raw) : c.raw;
    /* Production sends none since 30 Oct 2026; CAPTURE_EVAL_CORRECTIONS=1 adds them back to compare. */
    const corrections = process.env.CAPTURE_EVAL_CORRECTIONS === "1" ? context.correctionExamples : [];
    const prompt = simpleSortPrompt({ raw, threads: context.threads, actions, corrections, now: c.at, tzOffset: -420 });
    const sorted = normalizeSimpleSort(await generateSimpleSort({ tier, prompt }), { threads: context.threads, actions, raw, now: c.at, tzOffset: -420 });
    const filing = { threads: context.threads, latest: context.latest };
    const filed = await fileThoughts(sorted, filing, (note) => fileThought(note, raw, filing, { tier }));
    const threads = filed.flatMap((item) => (item.threads ?? []).map((t) => ("id" in t ? t.id : `new:${t.name}`)));
    out.push({ ...c, threads, kinds: filed.map((item) => item.kind), right: threads.includes(c.expect!) });
    process.stderr.write(".");
  } catch (error) {
    out.push({ ...c, error: String(error).slice(0, 300) });
    process.stderr.write("x");
  }
}
const score = (set: string) => `${out.filter((r) => r.set === set && r.right).length}/${out.filter((r) => r.set === set).length}`;
console.log(`\nrefiled ${score("refiled")} control ${score("control")} errors ${out.filter((r) => "error" in r).length} → ${save("filing", out)}`);
