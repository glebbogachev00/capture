import { generateObject } from "ai";
import { z } from "zod";
import { clientIp } from "@/lib/clientIp";
import { modelRateLimit } from "@/lib/limiter";
import { withFallback } from "@/lib/providers";
import { preferredFor } from "@/lib/routing";

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
/* One batch per request, and every other route in this app is capped at 60
   seconds for a reason: that is the platform's ceiling. An earlier version
   paced four batches inside a single request, took eighty to ninety
   seconds, and was therefore killed every time in production while working
   perfectly on a developer machine. The pacing now lives on the client,
   which can wait as long as it likes. */
export const maxDuration = 60;

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

  try {
    const answered = await withFallback(async (tier) => {
      const { object } = await generateObject({
        model: tier.model,
        maxRetries: 0,
        schema: Result,
        system: "You are capture's untangler.",
        prompt: promptFor(body),
        providerOptions: tier.providerOptions,
      });
      return object;
    }, preferredFor("untangle"));

    /* Only ids that were actually offered. A model that invents one would
       otherwise move a note nobody was asked about. */
    const offered = new Set(body.from.frags.map((f) => f.id));
    const move = (answered.value.move ?? []).filter((m) => offered.has(m.id));

    /* A rename is only worth offering when it DROPS something the name was
       listing. "Bugs, Issues and Additions" becoming "Bugs" is the point:
       the label was telling every sort that additions live there while the
       person had decided they do not. "Capture." becoming "Capture app" is
       the model renaming for its own sake, and a thread's name is its
       identity. So the new name must be shorter and built only from words
       the old one already had. */
    const words = (t: string) =>
      t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
    const old = new Set(words(body.from.name));
    const suggested = answered.value.rename?.trim() ?? "";
    const narrows =
      !!suggested &&
      suggested !== body.from.name &&
      suggested.length < body.from.name.length &&
      words(suggested).every((w) => old.has(w));

    return Response.json({
      move,
      rename: narrows ? suggested : null,
      via: answered.via,
    });
  } catch {
    /* No proposal today. Nothing is wrong with the board — it just does not
       get asked about until the next time. */
    return Response.json({ error: "offline" }, { status: 503 });
  }
}
