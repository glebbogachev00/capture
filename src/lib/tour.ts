/**
 * The playground tour: four captures, not four tooltips.
 *
 * A stranger's first minute on an empty board is the funnel's weakest
 * moment — the landing page made promises and the board asks them to
 * start from nothing. A coach-mark tour would contradict the product's
 * own argument (the app is quiet; an overlay is the app lecturing), and
 * there is almost no interface to point at anyway. What needs teaching is
 * what to SAY, so the tour hands over the right sentences in the right
 * order and lets the real sorter do the convincing.
 *
 * Steps advance on real state changes — a capture landing, an undo
 * answered, a screen opened — never on "next" clicks, so the tour can't
 * drift out of sync with what actually happened, and a person who ignores
 * it and does their own thing completes it anyway.
 */

export type TourStep = {
  id: string;
  title: string;
  body: string;
  /** A sentence to offer. Editable — the moment should still be theirs. */
  prefill?: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "both",
    title: "Say a thought that is two things at once",
    body:
      "A task and a question in one sentence. Use ours or say your own, then press Capture and watch where it lands.",
    prefill:
      "uh fix the signup bug before friday and i keep going back and forth on usage based pricing vs seats",
  },
  {
    id: "teach",
    title: "Now change its mind",
    body:
      "Capture this one. When the green banner lands, press Undo — it will ask what it should have been. Pick any answer; the point is that it is remembered.",
    /* Deliberately observational: a sentence with an extractable task can
       land as "both", and a both capture has no kind-question to ask —
       the step's whole promise. */
    prefill:
      "the mornings i write first go well, the ones i start with email do not. not sure it is the writing",
  },
  {
    id: "thread",
    title: "Open the thread",
    body:
      "The Threads tab, then tap the one your first capture opened. “Where this stands” is rewritten each time you add to it, and it names the next move when there is one.",
  },
  {
    id: "record",
    title: "See the record",
    body:
      "The looping-arrows button in the header. Everything you said, what became of it, and one Copy button that hands the lot to an agent.",
  },
];

/** What the board and screens must show for a step to count as done. */
export type TourCtx = {
  captures: number;
  /** Answered undo corrections — the teaching loop actually closed. */
  answered: number;
  threadOpen: boolean;
  recordOpen: boolean;
};

export function tourStepDone(step: number, ctx: TourCtx): boolean {
  switch (TOUR_STEPS[step]?.id) {
    case "both":
      return ctx.captures >= 1;
    case "teach":
      return ctx.answered >= 1;
    case "thread":
      return ctx.threadOpen;
    case "record":
      return ctx.recordOpen;
    default:
      return false;
  }
}
