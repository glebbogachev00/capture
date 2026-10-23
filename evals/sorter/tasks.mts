/**
 * Does the sorter find the tasks the person would, and only those?
 *   npx tsx --conditions=react-server evals/sorter/tasks.mts
 * "missed": they pulled a task out by hand (want one); "plain": left as a note (want none).
 * Subscription by default (see tier.ts); CAPTURE_EVAL_ALL=1 for every case.
 */
import { tightenActions } from "@/lib/actionText.server";
import { shouldFormat } from "@/lib/captureFormat";
import { formatCapture } from "@/lib/captureFormat.server";
import { generateSimpleSort, normalizeSimpleSort, simpleSortPrompt } from "@/lib/simpleSort";
import { semanticSortContext } from "@/lib/sortContext";
import { boardAt, loadBoard, loadCases, save, type Result } from "./common";
import { announce, evalTier } from "./tier";

const full = loadBoard();
const cases = loadCases("task-cases.json");
const tier = evalTier();
announce(tier, cases.length);
const out: Result[] = [];
for (const c of cases) {
  try {
    const board = boardAt(full, c);
    const actions = board.actions.filter((a) => !a.unsorted && !a.done && !a.faded).map((a) => ({ id: a.id, text: a.text }));
    const context = semanticSortContext(board, c.raw, [], c.at);
    const raw = shouldFormat(c.raw) ? await formatCapture(c.raw, { tier }).catch(() => c.raw) : c.raw;
    const prompt = simpleSortPrompt({ raw, threads: context.threads, actions, now: c.at, tzOffset: -420 });
    const sorted = normalizeSimpleSort(await generateSimpleSort({ tier, prompt }), { threads: context.threads, actions, raw, now: c.at, tzOffset: -420 });
    const final = await tightenActions(sorted, { tier, raw });
    out.push({ ...c, kinds: final.map((i) => i.kind), tasks: final.filter((i) => i.kind === "action").map((i) => i.text) });
    process.stderr.write(".");
  } catch (error) {
    out.push({ ...c, error: String(error).slice(0, 300) });
    process.stderr.write("x");
  }
}
const missed = out.filter((r) => r.set === "missed"), plain = out.filter((r) => r.set === "plain");
console.log(`\nmissed→task ${missed.filter((r) => r.tasks?.length).length}/${missed.length} plain→no task ${plain.filter((r) => r.tasks && !r.tasks.length).length}/${plain.length} errors ${out.filter((r) => "error" in r).length} → ${save("tasks", out)}`);
