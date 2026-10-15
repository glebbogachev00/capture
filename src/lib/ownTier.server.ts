import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import type { AiProvider } from "@/lib/aiProviders";
import type { Tier } from "@/lib/providers";

/**
 * The AI a person connected, for the length of one request. Every model call
 * in it goes to their providers, in their order. A self-hosted Capture keeps
 * its own providers behind them as a safety net; Capture Cloud does not, so
 * a member's own AI never draws on the managed allowance.
 */
export type OwnTier = Tier & { provider: AiProvider; apiKey: string };
export type OwnAi = { tiers: OwnTier[]; fallback: boolean };

const ownAi = new AsyncLocalStorage<OwnAi>();
export const currentOwnAi = (): OwnAi | null => ownAi.getStore() ?? null;
export const withOwnAi = <T>(own: OwnAi, work: () => T): T => ownAi.run(own, work);
