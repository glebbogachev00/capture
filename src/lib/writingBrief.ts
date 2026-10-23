import type { VoiceReading } from "./model";

/**
 * How to write as this person, handed to an agent with their notes.
 *
 * The voice reading says how someone talks; an article is not talk. A draft
 * that only had "how I talk" copied the fillers onto the page and still read
 * like an AI: generic examples, a summary for an ending, every line the same
 * weight. What makes a first draft good enough to only glance over is three
 * things, so this hands over all three:
 *
 *   - their point of view (what they believe, in their own words), and how
 *     their voice carries onto the page, both read from their own notes;
 *   - a fixed craft standard: signal over noise, a simple story, writing
 *     that does not read as AI;
 *   - a last pass the agent runs before handing the draft back.
 *
 * Only an agent reads this. It travels in "Copy for your AI" and in a copied
 * thread; nothing of it is shown on screen. A copied thread carries this in
 * place of "How I talk": given the spoken phrases, the agent wrote them in.
 *
 * Measured by drafting the same article from three of the owner's threads
 * with the old and the new handoff (Sonnet 5.5) and judging blind, both
 * orders. The first version tied 3/6: spoken fillers copied from "How I
 * talk", listicle headings, a closing question, invented history. With the
 * rules on invention, prose and fillers, and this in place of "How I talk",
 * it won 4/6, and one of the two losses was the judge calling a statistic
 * invented that was in the owner's saved excerpt.
 */

export const WRITING_STANDARD: string[] = [
  "### Only what is in my notes",
  "- Everything about me comes from my notes: no invented history, numbers, quotes, sources or examples. Where something is missing, leave a short [bracket] for me to fill instead of making it up.",
  "",
  "### Signal, not noise",
  "- Every sentence earns its place: it makes the point, shows it, or moves the reader to the next line. If a sentence can go without losing anything, it goes.",
  "- One idea per paragraph, said first. Short paragraphs.",
  "- Specific beats general: use the real moments, numbers, names and examples from my notes.",
  "",
  "### A simple story",
  "- Open on the moment or the problem, not on background or a definition.",
  "- Make the reader feel the problem before offering the answer: what was going on, what it cost, what I tried, what changed.",
  "- One thread at a time, easy to follow. End on the point or the next step: never a summary of what was just said, never a question to the reader.",
  "",
  "### Human, not AI",
  "- Prose, the way I would post it: no headings, bold labels or numbered sections unless I ask for them.",
  "- Plain words and short sentences, the way I would say it to a friend, without spoken fillers or check-ins (\"Okay so\", \"So yeah\", \"right?\").",
  "- As firm as I am, no softer and no bolder. No claims I never made.",
  "- None of what gives AI writing away: \"delve\", \"in today's fast-paced world\", \"it's not just X, it's Y\", \"game-changer\", \"unlock\", \"elevate\", \"navigate\", a question as the opening line, lists of three for rhythm, dashes for drama, \"In conclusion\" or \"Ultimately\".",
  "",
  "### Before you hand it over",
  "- Reread it one sentence at a time and cut every sentence that adds nothing.",
  "- Check every claim and example against my notes.",
  "- Read it as me, and change any sentence I would not say.",
];

/** "How to write as me", for an agent drafting from these notes. */
export function writingForAgents(voice: VoiceReading | undefined, heading: string): string[] {
  const viewpoint = voice?.viewpoint ?? [];
  const onThePage = voice?.onThePage ?? [];
  return [
    heading,
    "",
    "When you draft something from these notes (an article, a post, a reply), write it as me: a first draft I only need to glance over. " +
      "How I talk out loud is not how I write: follow this, not my spoken habits.",
    ...(viewpoint.length ? ["", "### What I believe", ...viewpoint.map(({ claim, words }) => `- ${claim} (“${words}”)`)] : []),
    ...(onThePage.length ? ["", "### My voice on the page", ...onThePage.map((line) => `- ${line}`)] : []),
    "",
    ...WRITING_STANDARD,
  ];
}
