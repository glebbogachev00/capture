import { google } from "@ai-sdk/google";
import { createGroq, groq } from "@ai-sdk/groq";
import { mistral } from "@ai-sdk/mistral";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";

/**
 * The model chain, tried in order until one answers.
 *
 * Free tiers run out, and when the only provider is spent the app stops being
 * able to think at all. Each tier is included only when its key is present, so
 * a machine with just one key configured behaves exactly as before.
 *
 * Model ids are overridable by env so a retired model can be swapped without
 * a deploy from source.
 */

export type Tier = {
  name: string;
  model: LanguageModel;
  providerOptions?: ProviderOptions;
};

export function chain(): Tier[] {
  const tiers: Tier[] = [];

  // Most capture calls are small, frequent, and latency-sensitive — every
  // capture sorts, every thread update re-summarises, every edit is
  // proofread — so the fastest free tiers lead: Groq, then Mistral. Gemini
  // is the reliable quality fallback. OpenRouter is last: its free models
  // share tight rate limits and are the least dependable, and a paid account
  // should be an explicit choice, not the default path.
  const groqModel = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
  if (process.env.GROQ_API_KEY) {
    tiers.push({ name: "groq", model: groq(groqModel) });
  }

  /* A second Groq account, when there is one.
 
     Rate limits are per organisation, so a spare key is a whole extra
     allowance — the same model, the same quality, twice the headroom, for
     nothing. It sits directly behind the first because falling from Groq to
     Groq costs nothing, where falling to another provider can cost a lot:
     on one measured judgement the next tier down managed 22% where Groq
     managed 100%.
 
     Nothing changes for a board with only one key. */
  if (process.env.GROQ_API_KEY_2) {
    tiers.push({
      name: "groq-2",
      model: createGroq({ apiKey: process.env.GROQ_API_KEY_2 })(groqModel),
    });
  }

  if (process.env.MISTRAL_API_KEY) {
    tiers.push({
      name: "mistral",
      model: mistral(process.env.MISTRAL_MODEL || "mistral-small-latest"),
    });
  }

  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) tiers.push(geminiTier());

  // Last resort. The previous default (google/gemini-2.5-flash) is a paid
  // slug that 402s on a creditless account — it made the last-resort tier
  // dead. A :free model keeps it usable without credits; a funded account
  // can set OPENROUTER_MODEL to any paid slug it lists.
  if (process.env.OPENROUTER_API_KEY) {
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });
    tiers.push({
      name: "openrouter",
      model: openrouter.chat(
        process.env.OPENROUTER_MODEL || "openai/gpt-oss-20b:free"
      ),
    });
  }

  return tiers;
}

/** The Gemini tier, shared by the text chain and the vision chain. */
function geminiTier(): Tier {
  return {
    name: "gemini",
    model: google(process.env.GEMINI_MODEL || "gemini-3.6-flash"),
    // Gemini 3 reasons at length by default; a two-way sort does not need it.
    providerOptions: {
      google: { thinkingConfig: { thinkingLevel: "low" } },
    },
  };
}

/**
 * Tiers that can see an image, used for captioning a capture that carries a
 * photo before the sorter files it (Sprint 5). Groq's default model, Mistral,
 * and the OpenRouter default are text-only, so Gemini is the vision tier
 * until another key points at an explicitly vision-capable model. Empty when
 * no vision tier is configured — the app simply sorts without a caption,
 * exactly as it always has.
 */
export function visionChain(): Tier[] {
  const tiers: Tier[] = [];
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) tiers.push(geminiTier());
  return tiers;
}

export class NoProvidersError extends Error {
  constructor() {
    super("no model provider is configured");
  }
}

/**
 * Run `attempt` against each tier until one succeeds.
 *
 * The last error is rethrown when every tier fails, so the caller still gets a
 * real reason to show rather than a generic one.
 */
/**
 * A rate limit is a wait, not a failure.
 *
 * Every provider in the chain refusing at once is nearly always the same
 * thing: a per-minute token allowance, spent. The provider says so and even
 * says for how long — "Please try again in 15.3s". The chain used to try
 * each tier once and give up, so a capture failed to sort over a ceiling
 * that would have cleared before the person finished reading the error.
 *
 * Worth distinguishing from a real outage, which no amount of waiting
 * fixes. So this waits only when a refusal was a rate limit, waits roughly
 * as long as it was told to, and tries the chain once more.
 */
function rateLimited(error: unknown): boolean {
  const status = (error as { statusCode?: number })?.statusCode;
  if (status === 429) return true;
  const text = String((error as { message?: string })?.message ?? "");
  return /rate.?limit|too many requests/i.test(text);
}

/** How long the provider asked us to wait, in ms, if it said. */
function askedToWait(error: unknown): number | null {
  const text = String((error as { message?: string })?.message ?? "");
  const m = /try again in ([0-9]+(?:\.[0-9]+)?)\s*(m|s)/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2].toLowerCase() === "m" ? n * 60_000 : n * 1000;
}

/** A daily limit, as opposed to a per-minute one. The distinction decides
    everything below: a minute rolls over while the person is still reading
    the error, a day does not. */
function dailyLimited(error: unknown): boolean {
  return (
    rateLimited(error) &&
    /per day|tpd/i.test(String((error as { message?: string })?.message ?? ""))
  );
}

/* Tiers whose DAILY budget is spent, and when to look again.
 
   Module-level on purpose: within a warm serverless instance every request
   shares it, so one discovered exhaustion spares every later request the
   probe. Without this, every single sort re-asked two dead Groq orgs before
   reaching the provider that would answer — wasted round-trips on the path
   a person is actively waiting on, all day, until midnight-ish. A cold
   instance re-learns with one cheap failure.
 
   The window honours what the provider said, capped: Groq's daily limit is
   a rolling 24h window that trickles back, so a probe every few minutes is
   how a recovered tier gets found again. */
const dailyOut = new Map<string, number>();
const DAILY_RECHECK_CAP_MS = 10 * 60_000;

/* Long enough for a per-minute window to roll over, short enough that the
   person is still waiting on the same capture rather than a new one. */
const DEFAULT_WAIT_MS = 18_000;
/* The whole route is capped at sixty seconds, so there is room for exactly
   one more pass through the chain and no more. */
const MAX_WAIT_MS = 25_000;

/** Test hook: clear the daily-exhaustion memory between cases. */
export function _resetDailyOut(): void {
  dailyOut.clear();
}


/**
 * What a provider failure is allowed to say in a log.
 *
 * The old line logged the whole error object, and an AI SDK APICallError
 * carries `requestBodyValues` — the request body, which for this app means
 * the person's own captured words, en route to a server log they never
 * agreed to. A failure log's job is "which tier, why, how long to wait",
 * and that is ALL that survives:
 *
 *   - provider name, HTTP status, error name;
 *   - the message, but only after every field that can carry payload
 *     (request bodies, response bodies, headers, causes) is discarded —
 *     and truncated, because provider messages occasionally echo input.
 *
 * Nothing else. Add a field here only if you can argue it cannot contain
 * what someone said.
 */
export function sanitizeProviderError(error: unknown): {
  name: string;
  status?: number;
  message: string;
} {
  const e = error as {
    name?: string;
    statusCode?: number;
    message?: string;
  } | null;
  return {
    name: e?.name ?? "Error",
    status: e?.statusCode,
    message: String(e?.message ?? "").slice(0, 200),
  };
}

export async function withFallback<T>(
  attempt: (tier: Tier) => Promise<T>,
  /* Which provider should go first for this job.
 
     The chain is a fallback order, so without this every request piles onto
     the same provider and the other three allowances sit unused — one
     account rate-limited while three are idle. Each provider has its own
     per-minute budget, so putting different work on different providers is
     free capacity.
 
     Which job goes where is measured, not guessed. On routing, Mistral
     scored 77% against Claude's 74% — no worse. On untangling, Mistral
     managed 22-43% recall where Groq managed 100%. So background work that
     nobody is waiting on goes elsewhere, and the fast provider is kept for
     what the person is standing there for.
 
     It is a preference, not a pin: if the named provider is missing or
     refuses, the rest of the chain still answers. */
  prefer?: string
): Promise<{ value: T; via: string }> {
  const all = chain();
  /* A preference moves that provider to the front and keeps everything
     else in its usual order. Prefixes match too, so preferring "groq" also
     brings "groq-2" forward — the spare account is the same model, and
     falling from one Groq key to the other costs nothing, where falling to
     a different provider can cost a great deal. */
  const tiers = prefer
    ? [
        ...all.filter((t) => t.name === prefer || t.name.startsWith(prefer + "-")),
        ...all.filter((t) => t.name !== prefer && !t.name.startsWith(prefer + "-")),
      ]
    : all;
  if (!tiers.length) throw new NoProvidersError();

  const round = async (): Promise<
    { ok: true; value: T; via: string } | { ok: false; error: unknown; limited: boolean }
  > => {
    let last: unknown;
    let limited = false;
    /* Skip tiers known to be out for the day — but never skip our way to
       an empty round: if the breaker would silence everyone, ignore it and
       ask anyway. Being wrong about a recovery costs one failed call;
       refusing to try at all costs the capture. */
    let live = tiers.filter((t) => (dailyOut.get(t.name) ?? 0) < Date.now());
    if (!live.length) live = tiers;
    for (const tier of live) {
      try {
        return { ok: true, value: await attempt(tier), via: tier.name };
      } catch (error) {
        last = error;
        if (rateLimited(error)) limited = true;
        if (dailyLimited(error)) {
          dailyOut.set(
            tier.name,
            Date.now() + Math.min(askedToWait(error) ?? DAILY_RECHECK_CAP_MS, DAILY_RECHECK_CAP_MS)
          );
        }
        console.warn(
          `[capture] ${tier.name} failed, trying next`,
          sanitizeProviderError(error)
        );
        // Remember which tier this error came from so the message shown to
        // the operator names the provider that actually failed.
        try {
          (error as { provider?: string }).provider = tier.name;
        } catch {
          /* frozen error object; message stays generic */
        }
      }
    }
    return { ok: false, error: last, limited };
  };

  const first = await round();
  if (first.ok) return { value: first.value, via: first.via };
  /* Only a rate limit earns a second pass. An outage does not get better
     for being asked twice, and the person is waiting — and neither does a
     DAILY limit: eighteen seconds against a budget that refills over a day
     is pure waiting-room, so it fails now and the client parks the capture
     unsorted instead. */
  if (!first.limited || dailyLimited(first.error)) throw first.error;

  const wait = Math.min(askedToWait(first.error) ?? DEFAULT_WAIT_MS, MAX_WAIT_MS);
  console.warn(`[capture] every tier rate-limited; waiting ${wait}ms and trying once more`);
  await new Promise((r) => setTimeout(r, wait));

  const second = await round();
  if (second.ok) return { value: second.value, via: second.via };
  throw second.error;
}
