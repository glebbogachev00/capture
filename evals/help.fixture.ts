import { EMPTY, type Action, type Board, type Frag, type Thread } from "@/lib/model";

/**
 * A synthetic board that looks like a real one after a few months of
 * dictation — and the answers a person would expect from it.
 *
 * Everything here is invented. The mess is planted on purpose, and each
 * plant is labelled below, so the eval can tell help from harm:
 *
 *   questions  asked in other words than the notes use, the way people ask
 *   noise      one-liners that mean nothing on their own
 *   misfiled   real notes sitting in the wrong thread
 *   repeats    the same thought said twice in one thread
 *   traps      pairs that look alike but must stay apart (a question and
 *              its answer, a plan and its change, two different ideas)
 *   facts      what must still be on the board after Approve all
 */

export const NOW = new Date(2026, 8, 30, 12).getTime();
const DAY = 864e5;
const ago = (days: number) => NOW - days * DAY;

const note = (id: string, days: number, text: string, extra: Partial<Frag> = {}): Frag =>
  ({ id, at: ago(days), text, ...extra });
const thread = (id: string, name: string, summary: string, frags: Frag[]): Thread =>
  ({ id, name, summary, frags });
const act = (id: string, days: number, text: string, extra: Partial<Action> = {}): Action =>
  ({ id, at: ago(days), text, done: false, shelf: "weeks", expires: null, ...extra });

export const board: Board = {
  ...EMPTY,
  threads: [
    thread("pricing", "Pricing", "Annual plan decided at $96 a year; monthly stays $10. Free tier has no sync.", [
      note("pr1", 40, "Thinking we charge $10 a month, monthly only, keep it simple."),
      note("pr2", 25, "Talked to Priya — she'd pay yearly if it was cheaper. Annual at $8 a month billed yearly?"),
      note("pr3", 18, "Decided: annual plan at $96 a year, monthly stays $10."),
      note("pr4", 17, "annual is $96/yr and monthly $10 — that's the decision"),
      note("pr5", 9, "Free tier: capture and sort only, no sync."),
      note("pr6", 3, "ok and also"),
      note("pr7", 2, "the grout is grey not white"),
    ]),
    thread("kitchen", "Kitchen renovation", "Tomasz starts 14 October; tiles and island chosen.", [
      note("ki1", 60, "Plumber Tomasz quoted €1,450 for moving the sink."),
      note("ki2", 45, "Tiles: going with the matte grey 30x60 from Keramika."),
      note("ki3", 44, "matte grey 30x60 tiles from Keramika — ordered them today"),
      note("ki4", 20, "Tomasz can start 14 October."),
      note("ki5", 12, "Should the island be oak or walnut?"),
      note("ki6", 6, "Going with oak for the island, walnut was €600 more."),
      note("ki7", 4, "test"),
    ]),
    thread("retake", "Retake", "Screen demos with dead air trimmed; export is slow on long videos.", [
      note("re1", 50, "Retake: record a screen demo and the AI trims the dead air."),
      note("re2", 30, "Retake export is slow on long recordings — 4 minutes for a 20-minute video."),
      note("re3", 29, "exporting in Retake takes forever on long videos, like 4 minutes for a 20 minute one"),
      note("re4", 15, "Idea: let people share a Retake clip as a link instead of a file."),
      note("re5", 14, "Share links could expire after 7 days so storage doesn't pile up."),
      note("re6", 5, "look into it"),
    ]),
    thread("health", "Health", "Vitamin D supplement; running three times a week, 5k getting faster.", [
      note("he1", 70, "Dr. Nowak: vitamin D at 18 ng/mL, take 2000 IU daily."),
      note("he2", 35, "Running 3x a week, 5k in 31 minutes now."),
      note("he3", 10, "5k down to 29:40 this morning!"),
      note("he4", 8, "yeah"),
    ]),
    thread("lisbon", "Lisbon trip", "12–19 March, flat in Alfama with Rita as host.", [
      note("li1", 90, "Lisbon in March — flying TAP, 12 to 19 March."),
      note("li2", 80, "Booked the flat in Alfama, the host is Rita, check-in after 3pm."),
      note("li3", 79, "Alfama flat is booked, Rita hosts, check in from 3pm"),
      note("li4", 40, "Want to do a day trip to Sintra."),
      note("li5", 20, "Rita's number: +351 912 345 678"),
    ]),
    thread("capture", "Capture app", "Short notes misfiled; decided the model decides, not length rules. People want to ask their board questions.", [
      note("ca1", 33, "Sorting misfiles short notes — maybe add a length rule?"),
      note("ca2", 26, "No length rule after all — the model should decide, word rules are brittle."),
      note("ca3", 11, "People want to ask questions of their board, not just search it."),
      note("ca4", 10, "users keep asking to query their notes instead of searching"),
      note("ca5", 7, "Ship Ask before the photo clean-up."),
      note("ca6", 1, "Maybe"),
    ]),
    thread("reading", "Reading", "Finished Four Thousand Weeks; reading The Creative Act.", [
      note("rd1", 100, "Reading 'Four Thousand Weeks' — the bit about finitude hit hard."),
      note("rd2", 50, "Finished Four Thousand Weeks. Next up: 'The Creative Act'."),
      note("rd3", 3, "Rick Rubin: the audience comes last."),
    ]),
    thread("car", "Car", "Insurance renews 2 November at €610; Allianz quoted €540.", [
      note("cr1", 120, "Car insurance renews 2 November, currently €610 a year."),
      note("cr2", 15, "Allianz quoted €540 for the same cover."),
      note("cr3", 6, "Sintra: go on a weekday and buy the Pena Palace tickets online."),
    ]),
    thread("mom", "Mom's birthday", "22 October; gift is a ceramic class.", [
      note("mo1", 30, "Mom's birthday is 22 October."),
      note("mo2", 20, "Gift idea: the ceramic class she mentioned, about €80."),
      note("mo3", 19, "and then"),
    ]),
    thread("newsletter", "Newsletter", "Every other Sunday, 300 subscribers; question subject lines win.", [
      note("nl1", 40, "Newsletter goes out every other Sunday, 300 subscribers so far."),
      note("nl2", 12, "Subject line test: questions beat statements by 12% on opens."),
      note("nl3", 11, "Question subject lines got 12% more opens than statements"),
      note("nl4", 9, "Dr. Nowak moved my follow-up to 4 November."),
    ]),
  ],
  actions: [
    act("a1", 8, "Email Priya the annual pricing page"),
    act("a2", 5, "Call Tomasz to confirm the 14 October start"),
    act("a3", 12, "Buy Mom the ceramic class voucher"),
    act("a4", 6, "Decide on switching car insurance to Allianz before 2 November"),
    act("a5", 3, "Book the Sintra day trip"),
    act("a6", 2, "Renew passport"),
    act("a7", 4, "do the thing"),
    act("a8", 7, "yeah and also check"),
    act("a9", 9, "follow up"),
  ],
  intentions: [{
    id: "i1", number: 1, rawInput: "i protect my mornings", at: ago(60), updatedAt: ago(60),
    expandedIntention: "I protect my mornings for deep work; nothing gets scheduled before 11.",
    recommendedActions: ["Phone stays in the kitchen until 11", "Meetings start at 11 or later", "Write first, email second"],
    counterIntentions: ["Checking Slack in bed", "Saying yes to 9am calls"],
  }],
};

/* --------------------------------- Ask --------------------------------- */

export type AskCase = {
  q: string;
  /** Every pattern must appear in the answer. */
  must?: RegExp[];
  /** None of these may appear (a stale or wrong answer). */
  mustNot?: RegExp[];
  /** False when the board does not hold the answer. */
  found: boolean;
  /** Notes (or actions) that answer it — used to judge what reached the model. */
  evidence?: string[];
  /** The thread a good answer points at. */
  thread?: string;
};

export const questions: AskCase[] = [
  { q: "What did I land on for pricing?", must: [/96/, /10/], found: true, evidence: ["pr3", "pr4"], thread: "pricing" },
  { q: "How much will the plumber charge?", must: [/1[,.]?450/], found: true, evidence: ["ki1"], thread: "kitchen" },
  { q: "When is the builder showing up?", must: [/14\s*Oct/i], found: true, evidence: ["ki4", "a2"], thread: "kitchen" },
  { q: "Which wood did I pick for the island?", must: [/oak/i], mustNot: [/(chose|picked|going with) walnut/i], found: true, evidence: ["ki6"], thread: "kitchen" },
  { q: "How fast am I running these days?", must: [/29:40/], found: true, evidence: ["he3"], thread: "health" },
  { q: "What's my vitamin D dose?", must: [/2[,.]?000/], found: true, evidence: ["he1"], thread: "health" },
  { q: "Who is hosting us in Portugal?", must: [/Rita/], found: true, evidence: ["li2", "li3"], thread: "lisbon" },
  { q: "What's the phone number for our Lisbon host?", must: [/912\s?345\s?678/], found: true, evidence: ["li5"], thread: "lisbon" },
  { q: "Is it cheaper to switch car insurers?", must: [/540/, /610/], found: true, evidence: ["cr1", "cr2"], thread: "car" },
  { q: "What's slowing down my screen recording tool?", must: [/export/i, /4 min/i], found: true, evidence: ["re2", "re3"], thread: "retake" },
  { q: "What present am I getting my mother?", must: [/ceramic/i], found: true, evidence: ["mo2", "a3"], thread: "mom" },
  { q: "Did subject lines phrased as questions do better?", must: [/12\s?%/], found: true, evidence: ["nl2", "nl3"], thread: "newsletter" },
  { q: "Are we adding a length rule for short notes?", must: [/\bno\b|\bnot\b|against|dropped|decided/i], mustNot: [/\byes\b,? we are/i], found: true, evidence: ["ca2"], thread: "capture" },
  { q: "When is my next doctor's appointment?", must: [/4\s*Nov/i], found: true, evidence: ["nl4"] },
  { q: "What is left to sort out for the trip?", must: [/Sintra/i], found: true, evidence: ["a5", "li4"], thread: "lisbon" },
  { q: "When is my dentist appointment?", found: false },
  { q: "What's my Netflix password?", found: false },
  { q: "How much did the new laptop cost?", found: false },
];

/* ------------------------------- Clean up ------------------------------- */

/** One-liners that mean nothing on their own: a good review removes these. */
export const noise = ["pr6", "ki7", "re6", "he4", "ca6", "mo3", "a7", "a8", "a9"];

/** Real notes in the wrong thread, and where they belong. */
export const misfiled: Record<string, string> = { pr7: "kitchen", cr3: "lisbon", nl4: "health" };

/** The same thought twice in one thread: a good combine finds these. */
export const repeats: string[][] = [["pr3", "pr4"], ["ki2", "ki3"], ["re2", "re3"], ["li2", "li3"], ["ca3", "ca4"], ["nl2", "nl3"]];

/** Look alike, must stay apart: a question and its answer, a plan and its
    reversal, a measurement and its later one, two different ideas. */
export const traps: string[][] = [["ki5", "ki6"], ["ca1", "ca2"], ["he2", "he3"], ["re4", "re5"], ["pr1", "pr3"], ["pr2", "pr3"]];

/** A repeat whose removal as "noise" is fine — its twin keeps the words. */
export const repeatIds = new Set(repeats.flat());

/** Must survive every approved change, somewhere on the board. */
export const facts = [
  "$96", "$10", "€1,450", "14 October", "matte grey", "ordered", "oak", "4 minutes", "7 days",
  "2000 IU", "29:40", "Alfama", "Rita", "+351 912 345 678", "Sintra", "Pena Palace", "€540", "€610",
  "22 October", "ceramic", "12%", "4 November", "Renew passport", "the audience comes last",
];
