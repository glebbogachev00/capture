import { generateObject } from "ai";
import { z } from "zod";
import { clientIp } from "@/lib/clientIp";
import { modelRateLimit } from "@/lib/limiter";
import { withFallback } from "@/lib/providers";

/**
 * The grouping lens, read by the model instead of by spelling.
 *
 * The local pass (group.ts) folds the Actions list by shared words. It is
 * instant and costs nothing, and it is blind to subject: three actions about
 * the same app — a bug in its heat map, a shortcut syntax, an idea for making
 * it more fun — share no vocabulary, so the list stayed flat and said no two
 * actions shared a subject.
 *
 * This pass only decides which rows sit together. It cannot edit, move,
 * merge or delete anything: the response is ids and a name for the pile,
 * and every id is checked against the list on screen before it is used.
 *
 * The prompt lives on the server for the same reason the others do — it
 * cannot be rewritten by whatever is on the client.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  actions: z.array(z.object({ id: z.string(), text: z.string() })),
});

const Result = z.object({
  groups: z.array(z.object({ label: z.string(), ids: z.array(z.string()) })),
});

const GROUP = `You are capture's grouping lens — a personal capture app. Below is a person's open actions. Fold them into a few piles by SUBJECT, so a long list becomes easier to scan. You are not editing anything: you only say which actions sit together and what to call each pile.

What makes a group:
- The actions are about the same project, place, person, or errand. "Fix heat map bug", "add shortened commands for capture" and "new gamification ideas for capture" are one group: they are all work on the same app, even though they share no words.
- Two or more actions. Never emit a group of one.
- A person would look at the pile and say "yes, those go together" without needing it explained.

What is NOT a group:
- Same shape of task, different subject. "Buy running clothes" and "Buy a birthday present" are both errands, but they are not one subject. Grouping by verb is useless.
- A catch-all. Never create "Misc", "Other", "General", "Personal" or "Tasks". An action that belongs with nothing must simply be left out.
- Everything in one pile. If the list has no real subjects in common, return no groups at all. An empty answer is correct and expected on a varied list.

The label:
- One to three words, naming the subject as the person would say it — "Capture app", "Kitchen", "Ovid", "Running". Take the person's own vocabulary from their wording wherever you can.
- Never a sentence, never a verb phrase, never a count.

Leave out anything you are unsure about. Fewer, obvious groups are the goal; a list that groups badly is worse than a list that stays flat.

The actions:
`;

/* Server-side caps: a hostile or buggy client must not be able to burn quota
   on one giant prompt. */
const CAP_ACTIONS = 60;
const CAP_TEXT = 200;

/** Below this there is nothing to fold, and a model call would be waste. */
const MIN_ACTIONS = 3;

function promptFor(actions: z.infer<typeof Body>["actions"]) {
  return (
    GROUP +
    actions
      .slice(0, CAP_ACTIONS)
      .map(
        (a) =>
          `- id=${a.id} :: ${a.text.length > CAP_TEXT ? a.text.slice(0, CAP_TEXT) + "…" : a.text}`
      )
      .join("\n")
  );
}

export async function POST(request: Request) {
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

  if (body.actions.length < MIN_ACTIONS) {
    return Response.json({ groups: [] });
  }

  try {
    const { value, via } = await withFallback(async (tier) => {
      const { object } = await generateObject({
        model: tier.model,
        maxRetries: 0,
        schema: Result,
        system: "You are capture's grouping lens.",
        prompt: promptFor(body.actions),
        providerOptions: tier.providerOptions,
      });
      return object;
    });
    return Response.json({ groups: value.groups, via });
  } catch {
    /* The lens is a bonus layer: the local word grouping is already on
       screen, so a failure here changes nothing the person can see. */
    return Response.json({ error: "offline" }, { status: 503 });
  }
}
