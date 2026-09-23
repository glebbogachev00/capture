import type { CorrectionEntry } from "./ledger";
import type { SortKind } from "./refiled";
import type { RulePreference } from "./rules";

export type SortCorrectionExample = {
  capture: string;
  chosenKind: SortKind;
  chosenThreadId?: string;
  chosenThreadName?: string;
};

type ThreadIdentity = { id: string; name: string };
const MAX_CORRECTIONS = 5;
const MAX_CAPTURE_CHARS = 240;
const MAX_DESTINATION_CHARS = 80;
const stableKey = (correction: CorrectionEntry) => `correction:${correction.id}`;
const legacyKey = (correction: CorrectionEntry) => correction.rule?.trim().toLocaleLowerCase() || null;
const bounded = (value: string, limit: number) => value.trim().replace(/\s+/gu, " ").slice(0, limit);

/** One bounded record powers Settings, persisted switch migration, and model
 * context. No representation gets more private text than another. */
type BoundedCorrection = {
  key: string;
  capture: string;
  chosenKind: SortKind;
  chosenThreadId?: string;
  chosenThreadName?: string;
  at: number;
  legacyKey: string | null;
};

type EligibleCorrection = CorrectionEntry & { chosenKind: SortKind };

function eligibleCorrections(corrections: CorrectionEntry[], max: number): EligibleCorrection[] {
  return [...corrections]
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
    .filter((correction): correction is EligibleCorrection =>
      Boolean(correction.accepted && correction.chosenKind && correction.context?.trim()))
    .slice(0, max);
}

function boundedCorrections(
  corrections: CorrectionEntry[],
  max = MAX_CORRECTIONS,
): BoundedCorrection[] {
  return eligibleCorrections(corrections, max).map((correction) => ({
    key: stableKey(correction),
    capture: bounded(correction.context, MAX_CAPTURE_CHARS),
    chosenKind: correction.chosenKind,
    chosenThreadId: correction.chosenThreadId?.trim() || undefined,
    chosenThreadName: correction.chosenThreadName?.trim()
      ? bounded(correction.chosenThreadName, MAX_DESTINATION_CHARS)
      : undefined,
    at: correction.at,
    legacyKey: legacyKey(correction),
  }));
}

/** Interpret old lowercase rule-wording exclusions as stable correction ids.
 * Unknown and duplicate persisted values are dropped so a later stable toggle
 * can genuinely remove the only exclusion for that record. */
export function canonicalForgottenCorrectionKeys(
  corrections: CorrectionEntry[],
  disabledKeys: string[] = [],
  max = MAX_CORRECTIONS,
): string[] {
  const records = boundedCorrections(corrections, max);
  const stable = new Set(records.map((record) => record.key));
  const legacy = new Map<string, string[]>();
  for (const record of records) {
    if (!record.legacyKey) continue;
    legacy.set(record.legacyKey, [...(legacy.get(record.legacyKey) ?? []), record.key]);
  }
  const canonical = new Set<string>();
  for (const value of disabledKeys) {
    if (stable.has(value)) canonical.add(value);
    for (const key of legacy.get(value.trim().toLocaleLowerCase()) ?? []) canonical.add(key);
  }
  return records.map((record) => record.key).filter((key) => canonical.has(key));
}

export function setCorrectionEnabled(
  corrections: CorrectionEntry[],
  disabledKeys: string[],
  key: string,
  enabled: boolean,
  max = MAX_CORRECTIONS,
): string[] {
  const canonical = canonicalForgottenCorrectionKeys(corrections, disabledKeys, max);
  if (enabled) return canonical.filter((item) => item !== key);
  return canonical.includes(key) ? canonical : [...canonical, key];
}

/** The same advisory examples shown in Settings. Stable ledger ids make the
 * switch durable even when wording or thread names later change. */
export function correctionPreferences(
  corrections: CorrectionEntry[],
  disabledKeys: string[] = [],
  max = MAX_CORRECTIONS,
): RulePreference[] {
  const disabled = new Set(canonicalForgottenCorrectionKeys(corrections, disabledKeys, max));
  return boundedCorrections(corrections, max).map((record) => {
    const destination = record.chosenKind === "thread" && record.chosenThreadName
      ? ` in ${record.chosenThreadName}`
      : "";
    return {
      key: record.key,
      text: `“${record.capture}” → ${record.chosenKind}${destination}`,
      accepts: 1,
      dismisses: 0,
      confidence: 1,
      lastAt: record.at,
      enabled: !disabled.has(record.key),
    };
  });
}

/** Turn explicit filing corrections into semantic examples for the model's
 * single reasoning pass. Current thread identity is resolved by exact id only;
 * a removed thread retains only its bounded historical name. */
export function correctionExamples(
  corrections: CorrectionEntry[],
  threads: ThreadIdentity[],
  forgottenRules: string[],
  max = MAX_CORRECTIONS,
): SortCorrectionExample[] {
  const forgotten = new Set(canonicalForgottenCorrectionKeys(corrections, forgottenRules, max));
  const currentThreads = new Map(threads.map((thread) => [thread.id, thread]));
  const examples: SortCorrectionExample[] = [];

  for (const record of boundedCorrections(corrections, max)) {
    if (forgotten.has(record.key)) continue;
    const example: SortCorrectionExample = {
      capture: record.capture,
      chosenKind: record.chosenKind,
    };
    if (record.chosenKind === "thread") {
      const current = record.chosenThreadId
        ? currentThreads.get(record.chosenThreadId)
        : undefined;
      if (current) {
        example.chosenThreadId = current.id;
        example.chosenThreadName = record.chosenThreadName ?? bounded(current.name, MAX_DESTINATION_CHARS);
      } else if (record.chosenThreadName) {
        example.chosenThreadName = record.chosenThreadName;
      }
    }
    examples.push(example);
  }
  return examples;
}
