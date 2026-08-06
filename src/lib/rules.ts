/**
 * The bounded personal model — Sprint 3.
 *
 * The correction ledger records what the user did with the engine's
 * proposals: accepted, dismissed, corrected. This module turns those records
 * into a handful of *rules* — plain sentences the sort engine can weigh as
 * advisory tendencies ("this person merges captures about X into thread Y"),
 * never orders.
 *
 * Bounded on purpose: at most RULES_CAP rules, each surfaced only after two
 * or more signals agree, each clearable in the UI (the forgotten set is
 * device-local). A bad rule can never go invisible or unbounded — the worst
 * it can be is cleared.
 */

import type { CorrectionEntry } from "./ledger";

export type LearnedRule = {
  /** Normalised identity: the rule text, lowercased. A correction with the
      same rule strengthens it rather than adding a new entry. */
  key: string;
  /** The rule as a plain sentence, newest phrasing wins. */
  text: string;
  /** How many accepted (positive) signals built this rule. */
  accepts: number;
  /** How many dismissed (negative) signals built it. */
  dismisses: number;
  /** accepts / (accepts + dismisses) — how one-sided the evidence is. */
  confidence: number;
  /** When the newest signal arrived. */
  lastAt: number;
};

/** How many rules the model may hold at once — the hard cap. */
export const RULES_CAP = 5;

/** A rule needs at least this many signals before it is worth saying out
    loud; a single accept or dismiss is noise. */
const MIN_SIGNALS = 2;

/** Confidence above this is a positive rule (the user wants it); below this
    it is a negative one (they don't). In between is mixed — the user is
    inconsistent, and the engine should ignore it rather than guess. */
const POSITIVE = 0.6;
const NEGATIVE = 0.4;

/** Recency decays over ~90 days; a rule untouched for that long loses its
    ranking edge but does not disappear — recency ranks, only clearing removes. */
const DECAY_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * The current rules, from the correction ledger.
 *
 * Only entries that carry a `rule` string count — that field is the
 * aggregate-able signal (rename → "threads get named X", a suggestion accept
 * → "merge captures like this into Y"). Free-text corrections (clean_fragment)
 * are deliberately not rules: they are spelling fixes, not preferences.
 *
 * `forgotten` holds the keys the user cleared; their rules stop appearing
 * (and stop being injected into the sort prompt) until new signals rebuild
 * them from scratch.
 */
export function deriveRules(
  corrections: CorrectionEntry[],
  forgotten: string[] = [],
  now: number = Date.now()
): LearnedRule[] {
  const forgottenSet = new Set(forgotten);

  /* Group by rule key, keeping the newest phrasing. */
  const groups = new Map<
    string,
    { text: string; accepts: number; dismisses: number; lastAt: number }
  >();
  for (const c of corrections) {
    if (!c?.rule || typeof c.rule !== "string") continue;
    const key = c.rule.trim().toLowerCase();
    if (!key || forgottenSet.has(key)) continue;
    const g = groups.get(key) ?? {
      text: c.rule.trim(),
      accepts: 0,
      dismisses: 0,
      lastAt: c.at,
    };
    if (c.accepted) g.accepts += 1;
    else g.dismisses += 1;
    // A key is an exact wording, so the phrasing is constant; only the
    // freshest signal time matters for recency ranking.
    if (c.at >= g.lastAt) g.lastAt = c.at;
    groups.set(key, g);
  }

  /* Signal → direction → ranking. */
  type Scored = LearnedRule & { _score: number };
  const candidates: Scored[] = [];
  for (const [key, g] of groups) {
    const total = g.accepts + g.dismisses;
    if (total < MIN_SIGNALS) continue;
    const confidence = g.accepts / total;
    // The middle band (≈50%) is the user being inconsistent — drop it.
    // Anything one-sided, in either direction, is a real preference.
    if (confidence >= NEGATIVE && confidence <= POSITIVE) continue;
    const recency = 1 - Math.min(1, (now - g.lastAt) / DECAY_MS);
    candidates.push({
      key,
      text: g.text,
      accepts: g.accepts,
      dismisses: g.dismisses,
      confidence,
      lastAt: g.lastAt,
      // Ranking blends how one-sided the evidence is with how fresh it is.
      _score: confidence * 0.6 + recency * 0.4,
    });
  }

  candidates.sort(
    (a, b) => b._score - a._score || (a.key < b.key ? -1 : 1)
  );

  const rules: LearnedRule[] = [];
  for (const c of candidates) {
    rules.push({
      key: c.key,
      text: c.text,
      accepts: c.accepts,
      dismisses: c.dismisses,
      confidence: c.confidence,
      lastAt: c.lastAt,
    });
    if (rules.length === RULES_CAP) break;
  }
  return rules;
}
