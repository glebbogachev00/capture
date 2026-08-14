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
- Say it plainly. The job is to state what they said as already true, in their own register — not to make it sound profound. The best output reads like the user wrote it themselves on a day they were being precise.
- Add NOTHING sensory or emotional they did not say. No weather, no light, no bodies — no "dawn light", "settling into my bones", "lightness in my shoulders", "warmth", "stillness". If they did not mention a feeling, do not supply one.
- Banned phrasings, because they are the sound of a machine trying to be moving: "I move through", "I stand in", "I carry ... with me", "I breathe", "I savor", "I bask", "fully present", "a sense of", "washes over", "anchors me", "ripples out".
- Ordinary words beat elevated ones. "rested" not "restored". "I sleep well" not "I am held by deep rest".
- One sentence is usually right. Two only when the intention genuinely has two parts. Never add a second sentence for rhythm.
- Present tense, first person, no hedging: never "I want", never "I will", never "I am learning to".

COUNTER-INTENTIONS:
- First-person, present-tense recurring behaviors that pull directly against THIS specific intention — the behaviors that would keep it from becoming real.
- Tied to the user's actual subject and specifics. If the intention is about visiting Japan, the counter-intentions are about travel, money, time off, fear of going — NOT generic "I fill my schedule with obligations" or "I distract myself with digital noise". Never drift into generic productivity or busyness tropes.
- Concrete habits, not abstract concepts. "I keep postponing booking the trip." not "Fear." "I talk myself out of spending the money." not "Doubt."
- Two to four items. Short. One sentence each.

RECOMMENDED ACTIONS:
- Exactly three actions taken FROM the fulfilled end-state — things this person does because it is already true, not steps toward making it true.
- Never "research", "schedule", "book", "finalize", "map out", "start", "plan". Assume it is done.
- Ordinary and concrete. What actually changes in a normal day when this is true — what they do, say, stop doing, or spend time on. A dull, real action beats a beautiful vague one.
- No savouring, no sharing-the-feeling, no gratitude, no "letting it shape how I move through the day". Those are filler, not actions.
- First person, present tense. One short sentence each. No motivational language.`;

function systemPrompt(principles: z.infer<typeof Principle>[] | undefined) {
  const active = (principles || []).filter((p) => p.enabled);
  if (!active.length) return BASE_SYSTEM_PROMPT;
  const list = active.map((p) => `- ${p.name}: ${p.description}`).join("\n");
  return `${BASE_SYSTEM_PROMPT}\n\nInternal principles to silently apply:\n${list}`;
}

function expandMessage(rawInput: string) {
  return `Raw input from the user: "${rawInput}"

Write it as already true, in plain first-person present tense, keeping the user's own words and specifics.

There are three ways to fail. Avoid all of them:

TOO ORNATE (the most common failure — invents feelings and scenery the user never mentioned):
Input: "I want to wake up at six and actually feel rested for once"
Output: "I rise at six, the soft dawn light brushing my eyes, and I actually feel rested, a gentle ease settling into my bones."
Why wrong: they said nothing about dawn light or their bones. It reads like a meditation app, not like them.

TOO ABSTRACT (turns a specific thing into a generic mindset):
Input: "I went to Japan for 2 weeks and visited all the places my soul desired"
Output: "I have a deep sense of fulfillment that anchors my daily life and allows me to live with intention."
Why wrong: Japan is gone. So are the two weeks. It could be anyone's intention about anything.

HEDGED (not written as already true):
Input: "I stop taking on client work I secretly resent"
Output: "I am learning to say no to client work that drains me."
Why wrong: "learning to" puts it in the future. An intention is inhabited, not approached.

RIGHT — plain, specific, already true:
Input: "I want to wake up at six and actually feel rested for once"
Output: "I wake at six and I'm actually rested."

Input: "I went to Japan for 2 weeks and visited all the places my soul desired"
Output: "I spend two weeks in Japan and get to every place I wanted to see."

Input: "I stop taking on client work I secretly resent"
Output: "I don't take on client work I resent."

Notice what the right answers have in common: they are shorter than the wrong ones, they add nothing the user did not say, and they sound like a person rather than a mission statement. Plain is the target, not a compromise.

Rules:
- Keep the user's exact subject and specifics. Change the tense and the clarity, nothing else.
- Usually one sentence. Present tense. Never "I want", "I will", or "I am learning to".

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
