import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { getCloudConfig } from "@/lib/supabase/config";
import { createCloudServiceClient } from "@/lib/supabase/service";
import type { Tier } from "./providers";

/**
 * How much AI a Cloud account uses: calls and tokens per provider and model,
 * added up over one request and written as that day's totals
 * (supabase/migrations/20261023120000_capture_ai_usage.sql). Counts only,
 * never text. Recording is best effort and never touches the request: no
 * table, no service key, or a failed write all leave the answer as it was.
 */

type Tally = { calls: number; inputTokens: number; outputTokens: number };
type Row = Tally & { provider: string; model: string };
type Recorder = (ownerId: string, day: string, rows: Row[]) => Promise<void>;

/* A usage field is a number in older specs and { total } in v4. */
const count = (value: unknown): number => {
  const total = typeof value === "number" ? value : (value as { total?: unknown } | undefined)?.total;
  return typeof total === "number" && Number.isFinite(total) && total > 0 ? Math.round(total) : 0;
};

/** One account's usage in one request. `flush` writes what has been counted
 * since the last flush, so work that outlives the request (a streamed reply)
 * can be counted after it. */
export class UsageLedger {
  private rows = new Map<string, Row>();
  constructor(private ownerId: string, private record: Recorder) {}

  add(provider: string, model: string, usage: unknown) {
    const key = `${provider}\u0000${model}`;
    const row = this.rows.get(key) ?? { provider, model, calls: 0, inputTokens: 0, outputTokens: 0 };
    const used = usage as { inputTokens?: unknown; outputTokens?: unknown } | undefined;
    row.calls += 1;
    row.inputTokens += count(used?.inputTokens);
    row.outputTokens += count(used?.outputTokens);
    this.rows.set(key, row);
  }

  flush() {
    if (!this.rows.size) return;
    const rows = [...this.rows.values()];
    this.rows.clear();
    void this.record(this.ownerId, new Date().toISOString().slice(0, 10), rows).catch(() => {});
  }
}

const current = new AsyncLocalStorage<UsageLedger>();

function meter(provider: string, ledger: UsageLedger): LanguageModelMiddleware {
  return {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate, model }) => {
      const result = await doGenerate();
      ledger.add(provider, model.modelId, result.usage);
      return result;
    },
    wrapStream: async ({ doStream, model }) => {
      const result = await doStream();
      return {
        ...result,
        stream: result.stream.pipeThrough(new TransformStream({
          transform(part, controller) {
            if (part.type === "finish") ledger.add(provider, model.modelId, part.usage);
            controller.enqueue(part);
          },
        })),
      };
    },
  } as LanguageModelMiddleware;
}

/** The ledger of the Cloud request being counted, if any. */
export const currentUsage = () => current.getStore();

/** The tier as given, metered when a Cloud request is being counted. */
export function metered(tier: Tier, ledger = current.getStore()): Tier {
  if (!ledger) return tier;
  return {
    ...tier,
    model: wrapLanguageModel({ model: tier.model as Parameters<typeof wrapLanguageModel>[0]["model"], middleware: meter(tier.name, ledger) }) as Tier["model"],
  };
}

async function recordInCloud(ownerId: string, day: string, rows: Row[]) {
  const config = getCloudConfig();
  const client = config?.status === "ready" ? createCloudServiceClient(config) : null;
  if (!client) return;
  await Promise.all(rows.map(async (row) => {
    await client.rpc("record_capture_ai_usage", {
      p_owner_id: ownerId, p_day: day, p_provider: row.provider.slice(0, 64), p_model: row.model.slice(0, 128),
      p_calls: row.calls, p_input_tokens: row.inputTokens, p_output_tokens: row.outputTokens,
    });
  }));
}

/** Run `work`, counting every AI call made inside it for this account, then
 * record the totals for today (UTC). The result or error of `work` passes
 * through untouched. */
export async function withUsage<T>(ownerId: string, work: () => Promise<T>, record: Recorder = recordInCloud): Promise<T> {
  const ledger = new UsageLedger(ownerId, record);
  try {
    return await current.run(ledger, work);
  } finally {
    ledger.flush();
  }
}
