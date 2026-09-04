import type { CaptureEntry } from "./ledger";
import { dayKey } from "./record";

/**
 * Playground mode — the public instance a stranger can be pointed at.
 *
 * Capture is local-first, which makes a public demo nearly free to offer:
 * every visitor's board lives in their own browser, and the only shared
 * cost is the model calls. But "deploy the existing app with the password
 * off" is NOT enough, because sync is unconditional: every client pushes
 * every change to /api/sync and polls it every ten seconds. With the gate
 * off and one hub behind it, every stranger's board would merge into one
 * shared board and every visitor would pull everyone else's captures — a
 * privacy incident on launch day, for a product whose promise is that your
 * thinking stays yours.
 *
 * So playground mode turns off, at the source, everything that reaches
 * past the browser:
 *
 *   - sync: no push, no poll, no "Sync now", no hub at all
 *   - dictation and voice: they point at Parakeet and Kokoro on Gleb's Mac
 *   - the bug reporter's token path (the form falls back to GitHub)
 *
 * and the server refuses those routes too, so a hand-built request gets the
 * same answer as the UI. Belt and braces: the flag is read on both sides.
 *
 * NEXT_PUBLIC_ so it reaches the client; inlined at build time, so a
 * playground build is a separate build, never a runtime switch on the real
 * deployment. Deploy it as its own Vercel project with no blob store, so it
 * cannot touch the real hub even by accident.
 */
export const PLAYGROUND = process.env.NEXT_PUBLIC_PLAYGROUND === "1";

/**
 * The five-capture daily browser allowance.
 *
 * This is a product boundary for ordinary visitors, not a security claim.
 * Today's count comes from the local ledger and resets with the visitor's
 * local calendar day. A determined person can clear site data and start over.
 * That is fine: the goal is a coherent tutorial experience, not quota
 * protection. The provider dashboard's daily spend ceiling remains the
 * global hard cost boundary.
 */
export const TRIAL_LIMIT = 5;

/**
 * Count distinct utterances in the ledger.
 *
 * A split capture (one sentence → action + thread) shares a `captureId` across
 * its two entries; without one, each entry is its own utterance. Undo changes
 * what landed, not whether a trial capture was used, so undone entries count.
 */
export function trialUsed(
  ledger: CaptureEntry[],
  now = Date.now()
): number {
  const today = dayKey(now);
  const firstSeen = new Map<string, number>();
  for (const e of ledger) {
    /* Imports and restores describe data movement, not a thought captured in
       the playground, so they do not spend today's allowance. */
    if (e.source === "import" || e.restored) continue;
    const id = e.captureId ?? e.id;
    const first = firstSeen.get(id);
    if (first === undefined || e.at < first) firstSeen.set(id, e.at);
  }
  return [...firstSeen.values()].filter((at) => dayKey(at) === today).length;
}

export function trialRemaining(
  ledger: CaptureEntry[],
  now = Date.now()
): number {
  return Math.max(0, TRIAL_LIMIT - trialUsed(ledger, now));
}

export function isTrialExhausted(
  ledger: CaptureEntry[],
  now = Date.now()
): boolean {
  return trialUsed(ledger, now) >= TRIAL_LIMIT;
}

export type TrialState = {
  exhausted: boolean;
  remaining: number;
  hint: string;
};

/** One reading of the trial for the submit guard, composer, and notice. */
export function trialState(
  ledger: CaptureEntry[],
  now = Date.now()
): TrialState {
  const remaining = trialRemaining(ledger, now);
  return {
    exhausted: remaining === 0,
    remaining,
    hint:
      remaining === 0
        ? "today's five captures are used"
        : remaining < TRIAL_LIMIT
          ? `${remaining} of ${TRIAL_LIMIT} captures left today — say it messy`
          : "five captures available today — say it messy",
  };
}

/** A synchronous one-flight gate. React state updates later; this closes the
 * same-tick window where button and keyboard submission could both start. */
export function createCaptureGate() {
  let active = false;
  return {
    enter() {
      if (active) return false;
      active = true;
      return true;
    },
    leave() {
      active = false;
    },
  };
}

/** Routes that reach past the browser. Refused outright in playground mode. */
export const PLAYGROUND_CLOSED = [
  "/api/sync",
  "/api/img",
  "/api/transcribe",
  "/api/tts",
  "/api/report",
] as const;

export function isClosedInPlayground(pathname: string): boolean {
  return PLAYGROUND_CLOSED.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

/** Where "run it yourself" points. */
export const QUICKSTART_URL =
  "https://github.com/glebbogachev00/capture#quickstart";

/**
 * A rate limit, said to a stranger.
 *
 * The routes answer 429 with "Too many requests. Try again in 40s." — fine
 * for the owner, who knows there is a limit and why. A visitor does not, and
 * the honest thing to tell them is that the shared instance is busy and the
 * real one is free. Only the limit message is rewritten; every other error
 * passes through untouched.
 */
export function playgroundError(message: string | undefined): string | undefined {
  if (!PLAYGROUND || !message) return message;
  if (/^too many/i.test(message)) {
    return "The playground is busy — try again in a few minutes, or run Capture yourself: it's free.";
  }
  return message;
}
