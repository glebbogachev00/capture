import { generateObject } from "ai";
import { z } from "zod";
import { explain } from "@/lib/aiError";
import { clientIp } from "@/lib/clientIp";
import { modelRateLimit } from "@/lib/limiter";
import { withFallback } from "@/lib/providers";

/**
 * The intention engine, carried over from the standalone intent app.
 *
 * The prompts below are reproduced as they were written there, worked
 * examples and all: they are tuned against two specific failure modes the
 * model falls into otherwise, and paraphrasing them undoes that tuning.
 *
 * What this gains by living here is the provider chain — intent spoke only to
 * Gemini, so a spent free tier stopped it dead.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

/* The original ran at 0.7; the prompt was written against that warmth. */
const TEMPERATURE = 0.7;

const Expanded = z.object({
  expandedIntention: z.string(),
  recommendedActions: z.array(z.string()),
  counterIntentions: z.array(z.string()),
});

const Principle = z.object({
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
});

const Body = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("expand"),
    rawInput: z.string(),
    principles: z.array(Principle).optional(),
  }),
  z.object({
    op: z.literal("refine"),
    current: Expanded,
    feedback: z.string(),
    principles: z.array(Principle).optional(),
  }),
]);

const BASE_SYSTEM_PROMPT = `You are the invisible clarity engine inside intent. You are never seen by the user. You return structured data only — no explanations, no commentary.

Your single purpose is to restate the user's intention in present tense exactly as they meant it — not to expand, generalize, or improve it.

Rules you never break:

EXPANDED INTENTION:
- Keep the user's exact subject and specifics (their places, names, numbers, words). Never abstract them into a broader category — "wake up at 6am" stays "wake up at 6am", never "a morning routine".
- Bring it to life. Restate it in present tense with a little embodiment and felt texture — how it feels to be living it. This is richer than a bare restatement, but every added word must stay true to what they actually said.
- Never invent new facts, mechanisms, or outcomes they didn't mention. Enrich the feeling, not the content.
- Present tense only. "I move through..." / "I stand in..." / "I carry..." — never "I want", never "I will".
- One to two sentences. Warm and grounded. No generic affirmation language, no filler.

COUNTER-INTENTIONS:
- First-person, present-tense recurring behaviors that pull directly against THIS specific intention — the behaviors that would keep it from becoming real.
- Tied to the user's actual subject and specifics. If the intention is about visiting Japan, the counter-intentions are about travel, money, time off, fear of going — NOT generic "I fill my schedule with obligations" or "I distract myself with digital noise". Never drift into generic productivity or busyness tropes.
- Concrete habits, not abstract concepts. "I keep postponing booking the trip." not "Fear." "I talk myself out of spending the money." not "Doubt."
- Two to four items. Short. One sentence each.

RECOMMENDED ACTIONS:
- Exactly three actions taken FROM the fulfilled end-state — as someone who has ALREADY achieved this and is now living inside the feeling of it.
- These are NOT steps to plan, prepare, or make the intention happen. Never "research", "schedule", "book", "finalize", "map out", "start". Assume it is already done.
- They express and inhabit the feeling — what this person naturally does now that they carry this fulfillment. Savoring, sharing, resting in it, letting it change how they move through everyday life.
- Written in first person, present tense. One sentence each. No motivational language.`;

function systemPrompt(principles: z.infer<typeof Principle>[] | undefined) {
  const active = (principles || []).filter((p) => p.enabled);
  if (!active.length) return BASE_SYSTEM_PROMPT;
  const list = active.map((p) => `- ${p.name}: ${p.description}`).join("\n");
  return `${BASE_SYSTEM_PROMPT}\n\nInternal principles to silently apply:\n${list}`;
}

function expandMessage(rawInput: string) {
  return `Raw input from the user: "${rawInput}"

Write one or two present-tense sentences that bring this intention to life as already real — keeping the user's own words and specifics, adding only a little embodiment and felt texture.

There are two ways to fail. Avoid both:

TOO ABSTRACT (invents concepts, turns a specific thing into a generic mindset — WRONG):
Input: "I went to Japan for 2 weeks and visited all the places my soul desired"
Output: "I have a deep sense of fulfillment that anchors my daily life through memories of Japan, requires brief moments of reflection, and allows me to focus on living with intention."
Why wrong: invents "daily life", "reflection", "validation". Erases Japan into a generic feeling. Uses a canned three-clause template.

TOO BARE (just swaps tense, adds nothing — WRONG):
Input: "I went to Japan for 2 weeks and visited all the places my soul desired"
Output: "I spend two weeks in Japan and visit every place my soul desires."
Why wrong: it's only the input in present tense. No life, no texture. This is a restatement, not an expansion.

JUST RIGHT (keeps every specific, present tense, a little embodiment — DO THIS):
Input: "I went to Japan for 2 weeks and visited all the places my soul desired"
Output: "I move through two weeks in Japan fully present, standing in every place my soul was drawn to, and I carry that fullness home with me."
Why right: keeps Japan, two weeks, soul-desired places. Adds felt presence ("fully present", "carry that fullness home") without inventing new facts.

Rules:
- Keep the user's exact subject and specifics. Enrich the feeling, never the facts.
- One to two sentences. Present tense. Warm and grounded — no canned affirmation phrasing.

Now write the expanded intention for: "${rawInput}"

Also return:
counterIntentions — 2 to 4 recurring behaviors that pull against THIS specific intention: the things that would keep it from becoming real. First-person, present tense, concrete habits (not concepts).

BAD (generic busyness/productivity tropes with no connection to the actual intention — WRONG):
- "I fill my schedule with back-to-back obligations that leave no room for stillness."
- "I prioritize productivity over quiet exploration."
- "I distract myself with digital noise."

GOOD (tied to the actual subject — visiting Japan — RIGHT):
- "I keep postponing booking the trip until the timing feels perfect."
- "I talk myself out of the cost every time I get close to committing."
- "I let work convince me I can't take two weeks away."

Keep them specific to what the user actually said, not generic self-improvement behaviors.

recommendedActions — exactly 3 actions taken FROM the fulfilled end-state: what this person does now that they have ALREADY achieved this and live inside the feeling of it. Not steps to plan or make it happen — assume it is already done.

BAD (planning steps toward the goal — WRONG):
- "I research and map out the specific locations in Japan that align with my interests."
- "I schedule a two-week block of time for travel."
- "I finalize my itinerary to visit every place on my list."

GOOD (living from the fulfilled feeling — RIGHT):
- "I return to the memory of standing in those places whenever I want to feel that peace again."
- "I share the story of what I saw with the people I love."
- "I let the calm I found there shape how I move through my ordinary days."

Each: first-person, present tense, one sentence.`;
}

function refineMessage(
  current: z.infer<typeof Expanded>,
  feedback: string
) {
  return `Current expanded intention: "${current.expandedIntention}"
Current counter-intentions: ${JSON.stringify(current.counterIntentions)}
Current recommended actions: ${JSON.stringify(current.recommendedActions || [])}

The user's refinement direction: "${feedback}"

Apply the same rules: present tense, faithful to the user's words, no filler. Produce a revised version that reflects the user's direction. Update recommendedActions if the refinement changes what actions would naturally follow.`;
}

export async function POST(request: Request) {
  // The intention engine spends real model quota; a single client can't loop it.
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

  if (body.op === "expand" && !body.rawInput.trim()) {
    return Response.json({ error: "nothing to expand" }, { status: 400 });
  }

  const message =
    body.op === "expand"
      ? expandMessage(body.rawInput)
      : refineMessage(body.current, body.feedback);

  try {
    const { value, via } = await withFallback(async (tier) => {
      const { object } = await generateObject({
        model: tier.model,
        maxRetries: 0,
        schema: Expanded,
        system: systemPrompt(body.principles),
        prompt: message,
        temperature: TEMPERATURE,
        providerOptions: tier.providerOptions,
      });
      return object;
    });
    return Response.json({ ...value, via });
  } catch (error) {
    console.error("intention failed", error);
    const { message: reason, status } = explain(error);
    return Response.json({ error: reason }, { status });
  }
}
