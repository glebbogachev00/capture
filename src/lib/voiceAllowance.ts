import { dayKey } from "./record";

/**
 * The free version's daily voice: ten minutes of recording per device per
 * local day.
 *
 * The same kind of boundary as the fifteen captures (TRIAL_LIMIT): counted
 * on the device, so clearing site data starts it over. That is fine; the
 * daily spend ceiling on the Groq dashboard is the hard cost bound, and the
 * server caps each recording's size and pace.
 */
export const VOICE_SECONDS_PER_DAY = 10 * 60;

const KEY = "capture:voice-used:v1";
const listeners = new Set<() => void>();

function readUsed(now: number): number {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as { day?: string; seconds?: number } | null;
    return stored?.day === dayKey(now) && Number.isFinite(stored.seconds) ? Math.max(0, stored.seconds!) : 0;
  } catch {
    return 0;
  }
}

/** Seconds of voice left today. */
export function voiceSecondsLeft(now = Date.now()): number {
  return Math.max(0, VOICE_SECONDS_PER_DAY - readUsed(now));
}

/** Counts a finished recording against today. */
export function spendVoice(seconds: number, now = Date.now()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ day: dayKey(now), seconds: readUsed(now) + Math.max(0, seconds) }));
  } catch {
    /* storage refused (private mode): the allowance simply isn't kept */
  }
  listeners.forEach((listener) => listener());
}

export function subscribeVoice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
