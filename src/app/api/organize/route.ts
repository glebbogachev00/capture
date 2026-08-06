import { generateObject } from "ai";
import { z } from "zod";
import { explain } from "@/lib/aiError";
import { clientIp } from "@/lib/clientIp";
import { modelRateLimit } from "@/lib/limiter";
import { withFallback } from "@/lib/providers";
import {
  mapAiProposals,
  renderBoardForPrompt,
  type RawAiProposal,
  type TidySnapshot,
} from "@/lib/organizeAi";

/**
 * The AI review behind Tidy ("keep it tidy").
 *
 * The deterministic scan (organize.ts) finds the same WORDS. This pass finds
 * the same IDEA: a fragment in "Morning routine" that is, in other words, the
 * exact thought already in "Coffee rituals" — word-matching can never connect
 * those. It also sees notes that are really tasks, real duplicates, misplaced
 * notes, and actions that belong with a thread.
 *
 * The product rule is non-negotiable and enforced twice: in the prompt (the
 * model is told never to merge whole threads), and in mapAiProposals (a
 * merge_threads kind is refused even if the model emits it).
 *
 * The prompt lives here rather than in the browser for the same reason the
 * sort prompt does: it can't be rewritten by whatever is on the client.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  /* at rides along so a duplicate can always name the newer copy — the
     original is never at risk, and both passes propose the same direction. */
  actions: z.array(z.object({ id: z.string(), text: z.string(), at: z.number() })),
  threads: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      summary: z.string().optional(),
      frags: z.array(
        z.object({ id: z.string(), text: z.string(), at: z.number() })
      ),
    })
  ),
  intentions: z.array(z.object({ id: z.string(), expanded: z.string() })),
});

const AiProposal = z.object({
  /* merge_threads is deliberately in the enum so a model that disobeys the
     prompt parses — then mapAiProposals refuses that ONE proposal instead
     of the schema failing the whole response and losing the valid ones. */
  kind: z.enum([
    "merge_fragments",
    "dup_action",
    "dup_fragment",
    "fold_action",
    "move_fragment",
    "extract_action",
    "merge_threads",
  ]),
  confidence: z.enum(["high", "medium"]),
  sourceId: z.string(),
  sourceFragId: z.string().optional(),
  targetId: z.string(),
  reason: z.string(),
});

const Result = z.object({ proposals: z.array(AiProposal) });

const TIDY = `You are capture's tidy engine — a personal capture app. Below is a person's board: actions (things to do), threads (running notes, each with fragments), and intentions (states they're calling into being). Your job is to reduce clutter and make the board easier to use — nothing else. Never restructure for its own sake; a board that is fine should stay exactly as it is.

Propose ONLY changes a person would immediately agree improve the board:

- merge_fragments — the SAME IDEA living in two notes, in different words, in different threads. This is the most valuable claim; look for it first. "I keep meaning to dial back the evening caffeine" and "cutting the 4pm espresso" are one thought. sourceId + sourceFragId name the note to move, targetId the thread that already holds the idea. Never propose this for merely same-topic notes.
- extract_action — a fragment that reads as a doable task ("I need to call the vet about Luna's shots", "remember to renew the domain"). The note becomes an action; this is explicitly wanted. Only when it is unambiguously a task. A complaint or observation ("we're out of cold brew again", "the faucet drips at night") is NOT a task — never extract it, and never invent the task it implies.
- dup_action / dup_fragment — the same task or note captured twice, worded differently. The copy is removed; the original stays.
- move_fragment — a note sitting in the wrong thread. If a note is clearly about another thread's subject (a groceries complaint belongs with the groceries thread), prefer this over extract_action.
- fold_action — an action that clearly belongs with a thread (it is really a note on that subject). Folding reduces the action list.

Rules that never bend:
- NEVER merge whole threads. Never output a "merge_threads" kind. Two threads that cover overlapping ground stay separate; at most, an individual fragment that is truly the same idea in another thread may move.
- Same-topic is not the same idea. "Morning routine" and "Coffee habits" both being about mornings is not a merge.
- When in doubt, propose nothing. A change that is not clearly an improvement must not happen. Silence is the correct answer.
- Never propose a change that would bury distinct content.
- reason is a plain sentence the person can verify against their own words ("Both notes say the same thing: cut the afternoon espresso"). Never a label like "similar keywords".
- Do not invent tasks — a complaint or observation is not a task. Do not move a note that also belongs where it sits.
- Fewer, confident proposals beat many weak ones. confidence "high" means you would defend it; "medium" means plausible but less certain; if unsure, "medium" or nothing.

The board:
`;

/* Server-side caps, mirroring the client's compactBoard — a hostile or
   buggy client must not be able to burn quota on one giant prompt. Text is
   clipped the same way; counts are sliced the same way. */
const CAP = { actions: 60, threads: 40, fragsPerThread: 12, intentions: 15 } as const;
const clip = (s: string, n: number) =>
  s.length > n ? s.slice(0, n) + "…" : s;

function capped(body: TidySnapshot): TidySnapshot {
  return {
    actions: body.actions.slice(0, CAP.actions).map((a) => ({
      id: a.id,
      text: clip(a.text, 200),
      at: a.at,
    })),
    threads: body.threads.slice(0, CAP.threads).map((t) => ({
      id: t.id,
      name: clip(t.name, 80),
      summary: t.summary ? clip(t.summary, 160) : undefined,
      frags: t.frags.slice(0, CAP.fragsPerThread).map((f) => ({
        id: f.id,
        text: clip(f.text, 240),
        at: f.at,
      })),
    })),
    intentions: body.intentions.slice(0, CAP.intentions).map((i) => ({
      id: i.id,
      expanded: clip(i.expanded, 160),
    })),
  };
}

function promptFor(body: TidySnapshot) {
  return TIDY + renderBoardForPrompt(capped(body));
}

export async function POST(request: Request) {
  // The review spends real model quota; a single client can't run it in a loop.
  const gate = modelRateLimit(clientIp(request));
  if (!gate.allowed) {
    return Response.json(
      { error: `Too many requests. Try again in ${gate.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } }
    );
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  if (!body.actions.length && !body.threads.length) {
    return Response.json({ error: "nothing to review" }, { status: 400 });
  }

  try {
    const { value, via } = await withFallback(async (tier) => {
      const { object } = await generateObject({
        model: tier.model,
        // A spent free tier reports "retry in 26s"; fail fast so the chain
        // can fall through to the next provider instead of making the user
        // wait out the backoff.
        maxRetries: 0,
        schema: Result,
        system: "You are capture's tidy engine.",
        prompt: promptFor(body),
        providerOptions: tier.providerOptions,
      });
      return object;
    });
    const proposals = mapAiProposals(body, value.proposals as RawAiProposal[]);
    return Response.json({ proposals, via });
  } catch (error) {
    console.error("organize failed", error);
    const { message, status } = explain(error);
    return Response.json({ error: message }, { status });
  }
}
