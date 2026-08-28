import { generateObject } from "ai";
import { z } from "zod";
import { clientIp } from "@/lib/clientIp";
import { modelRateLimit } from "@/lib/limiter";
import { withFallback } from "@/lib/providers";

/**
 * Which notes are sitting in the wrong one of two threads.
 *
 * Two threads on a real board kept being confused for each other: the same
 * kind of thought went to one some days and the other on others, and the
 * person corrected it by hand seven times. Three engines — a free model
 * chain, a much stronger model, and nearest-neighbour over meaning — all
 * failed on that pair in the same way, which is what a missing distinction
 * looks like rather than a hard one.
 *
 * So this does not try to sort better. The pair is identified from the
 * board's own history, without a model; this route only reads the two
 * threads and says which of the notes already in one would be better off in
 * the other. It is a bulk judgement over existing content, reviewed by the
 * person before anything moves — which is a far easier question than
 * deciding one capture's destination in the moment, and being right most of
 * the time is enough.
 *
 * It never proposes merging the two threads. A thread that collects what is
 * broken holds plenty that has nothing to do with the app it is confused
 * with; folding them together would bury it.
 */

export const runtime = "nodejs";
/* Paced batches take longer than a single call by design — see the pacing
   note below. */
export const maxDuration = 300;

const Body = z.object({
  /** The thread the person keeps moving things OUT of. */
  from: z.object({
    name: z.string(),
    frags: z.array(z.object({ id: z.string(), text: z.string() })).max(60),
  }),
  /** The thread they keep moving them INTO. */
  to: z.object({
    name: z.string(),
    /** Enough of what is already there to see what it is for. */
    frags: z.array(z.object({ text: z.string() })).max(30),
  }),
  /** The boundary in the person's own words, when they can state it.
   *
   * Inferring the line from two threads' contents only works when a line is
   * there to find. On a real board it often is not — the same kind of
   * thought had gone to both for months — and no amount of reading could
   * recover a rule that had never been applied. When the person can say
   * where the edge is, that is worth far more than any inference, so it
   * goes in front of the contents rather than beside them. */
  rule: z.string().max(400).optional(),
});

/* Every field required and non-nullable: Groq's strict json_schema rejects
   the whole request when `required` omits a property, and the failure is
   silent — the call falls through to a weaker provider and the feature
   quietly runs degraded. */
const Result = z.object({
  move: z
    .array(
      z.object({
        id: z.string().describe("the id of a fragment that should move"),
        why: z
          .string()
          .describe("at most 12 words, in the person's own terms, why it fits the other thread better"),
      })
    )
    .max(30),
  /* A thread whose name lists what it holds will go on collecting all of it.
     "Bugs, Issues and Additions" told every sort that additions live there,
     while the person had decided additions belong somewhere else entirely —
     so the label kept teaching the engine the opposite of the rule, and no
     amount of sorting skill could win against the thread's own name. Asking
     here costs nothing: whoever just decided what leaves is the one who can
     see whether the name still fits. */
  rename: z
    .string()
    .nullable()
    .describe(
      "a better name for the FIRST thread if its current name no longer describes what would be left in it — especially when the name lists a kind of note that is moving out. Null when the name still fits"
    ),
});

const UNTANGLE = `You are looking at two threads in someone's personal capture app that keep getting confused for each other. They have moved notes between these two by hand several times, so the boundary is real to them even though the sorter cannot find it.

Your job: read the notes currently in the FIRST thread and say which of them would be better off in the SECOND. Nothing else.

How to decide:
- If a rule is given below, it is the person's own account of where the boundary lies. Apply it exactly, and prefer it over anything you infer from the contents — they know what they meant and the threads may have drifted from it.
- Otherwise, read what the SECOND thread actually contains, and judge by that, not by its name. The name is a label; the contents are the definition.
- List EVERY note that belongs in the second thread, not only the clearest ones. The person reviews each row and unticks anything they disagree with, so a note you leave out is lost to them while a note you include wrongly costs one glance. When a note is borderline, include it.
- Being conservative here is the failure mode to avoid. Measured against a careful reading of a real thread, an earlier version of this prompt found four of the fourteen notes that should have moved, because it was told to prefer a short confident list. Do not do that.
- Notes about other apps or subjects entirely must still stay. "Not the second thread's subject" is the only reason to leave something behind.
- Judge the SUBJECT, not the vocabulary. Two threads about the same product cannot be told apart by the words they use.
- If nothing clearly belongs elsewhere, return an empty list. That is a good answer and a common one.

Then look at the FIRST thread's name once more, imagining the notes you are moving are already gone. If the name names a kind of note that is leaving — a name like "Bugs, Issues and Additions" when the additions are moving out — it will keep pulling those notes back, because every future sort reads that name and believes it. In that case suggest a shorter name describing only what remains. If the name still fits what is left, return null and say nothing.

Return only ids from the first thread's notes, exactly as given.

`;

function promptFor(b: z.infer<typeof Body>) {
  return (
    UNTANGLE +
    (b.rule ? `THE RULE THEY GAVE:\n${b.rule}\n\n` : "") +
    `FIRST thread — "${b.from.name}" — the notes to judge:\n` +
    b.from.frags
      .map((f) => `- id=${f.id} :: ${f.text.replace(/\s+/g, " ").slice(0, 240)}`)
      .join("\n") +
    `\n\nSECOND thread — "${b.to.name}" — what it already holds:\n` +
    b.to.frags
      .map((f) => `- ${f.text.replace(/\s+/g, " ").slice(0, 240)}`)
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

  if (!body.from.frags.length || !body.to.frags.length) {
    return Response.json({ move: [] });
  }

  /* Judged in batches, because the whole thread at once is too big a single
     request for the fastest provider's per-minute allowance — a full thread
     came to nearly 9,000 tokens against a 7,000 limit, so every call was
     rejected and fell through to a weaker model that is markedly worse at
     this. The batches are small enough to be accepted, and each one still
     sees the whole of the other thread, which is what the judgement needs.

     A second reason to batch: recall matters more than speed here. The
     person reviews every row, and a smaller list per call means fewer notes
     competing for attention in one answer. */
  const BATCH = 8;
  /* Just over a third of a minute per batch keeps three batches inside the
     per-minute token allowance with room to spare. */
  const PACE_MS = 22_000;
  const batches: (typeof body.from.frags)[] = [];
  for (let i = 0; i < body.from.frags.length; i += BATCH)
    batches.push(body.from.frags.slice(i, i + BATCH));

  try {
    const offered = new Set(body.from.frags.map((f) => f.id));
    const seen = new Map<string, { id: string; why: string }>();
    let via: string | undefined;
    let rename: string | null = null;

    for (const [i, frags] of batches.entries()) {
      /* Paced, not just split. The fastest provider allows 8,000 tokens a
         minute and each batch costs around 2,600, so three fired together
         still exceed it and the rest fall through to a weaker model that is
         markedly worse at this judgement. Waiting between them keeps every
         batch on the good model. This runs about once a month, so a minute
         spent here costs nothing and buys the difference between a list
         worth reviewing and one worth ignoring. */
      if (i > 0) await new Promise((r) => setTimeout(r, PACE_MS));
      const part = { ...body, from: { ...body.from, frags } };
      const answered = await withFallback(async (tier) => {
        const { object } = await generateObject({
          model: tier.model,
          maxRetries: 0,
          schema: Result,
          system: "You are capture's untangler.",
          prompt: promptFor(part),
          providerOptions: tier.providerOptions,
        });
        return object;
      });
      via = answered.via;
      for (const m of answered.value.move ?? [])
        if (offered.has(m.id) && !seen.has(m.id)) seen.set(m.id, m);
      /* The name only needs deciding once; the first batch that has an
         opinion is as good as any, since each sees the same two threads. */
      if (!rename && answered.value.rename?.trim()) rename = answered.value.rename.trim();
    }

    const value = { move: [...seen.values()], rename };
    const move = value.move;
    /* A rename is only worth offering alongside a real move; on its own it
       is an opinion about someone's vocabulary. */
    /* A rename is only worth offering when it DROPS something the name was
       listing. "Bugs, Issues and Additions" becoming "Bugs" is the whole
       point: the label was telling every sort that additions live there
       while the person had decided they do not. "Capture." becoming
       "Capture app" is the model renaming for its own sake, and a thread's
       name is its identity — a pointless suggestion beside a good list of
       moves makes the whole proposal look careless.

       So the new name has to be shorter and made only of words the old one
       already had. Anything else is not the fix this is for. */
    const words = (t: string) =>
      t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
    const old = new Set(words(body.from.name));
    const suggested = value.rename?.trim() ?? "";
    const narrows =
      !!suggested &&
      suggested !== body.from.name &&
      suggested.length < body.from.name.length &&
      words(suggested).every((w) => old.has(w));
    const named = move.length && narrows ? suggested : null;
    return Response.json({ move, rename: named, via });
  } catch {
    /* No proposal today. Nothing is wrong with the board — it just does not
       get asked about until the next time. */
    return Response.json({ error: "offline" }, { status: 503 });
  }
}
