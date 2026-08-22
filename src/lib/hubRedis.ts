import type { HubStore, StoredValue, WriteExpectation } from "./hubStore";

/**
 * The sync hub on Redis.
 *
 * Blob was the wrong primitive for this. The hub is one small document
 * that two devices poll every half minute, and Blob is a file store
 * metered by the month: the polling alone got the store suspended. A
 * key-value store is what a polled document wants, and it makes the hub
 * cheaper in two ways that Blob could not:
 *
 *   - The revision lives in its own key, so a poll reads a few bytes. The
 *     document itself is fetched only when the revision actually moved.
 *   - Compare-and-swap is a script, not an HTTP header: the store compares
 *     the revision it holds with the one the writer saw, and the write
 *     returns the new revision. A write that knows its own version is a
 *     write the server can serve from memory without guessing — Blob never
 *     handed one back.
 *
 * Pictures stay on Blob. They are fetched once per device and cached; at
 * that volume a file store is fine, and it is what a file store is for.
 *
 * Keys: `hub:<name>` holds the body, `hub:<name>:rev` the revision. The
 * client is the thinnest slice of @upstash/redis this needs, so a test can
 * stand in for it with a Map.
 */

export type RedisLike = {
  get(key: string): Promise<unknown>;
  mget(...keys: string[]): Promise<unknown[]>;
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
};

const body = (name: string) => `hub:${name}`;
const rev = (name: string) => `hub:${name}:rev`;

/**
 * Write only if the revision is still what the writer saw.
 *   ARGV[1] — the revision the writer read, or "" for "nothing there yet"
 *   ARGV[2] — the new body
 * Returns the new revision, or -1 when someone else got there first.
 */
const CAS = `
local cur = redis.call('GET', KEYS[2])
local seen = ARGV[1]
if (cur == false and seen == '') or (cur ~= false and tostring(cur) == seen) then
  redis.call('SET', KEYS[1], ARGV[2])
  return redis.call('INCR', KEYS[2])
end
return -1
`;

const asString = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);

export function redisStore(client: RedisLike): HubStore {
  return {
    async read(name): Promise<StoredValue | null> {
      const [doc, version] = await client.mget(body(name), rev(name));
      if (doc === null || doc === undefined) return null;
      /* @upstash/redis parses JSON-looking strings on the way back. The
         hub stores JSON, so hand it back as text either way. */
      const text = typeof doc === "string" ? doc : JSON.stringify(doc);
      return { body: text, version: asString(version) };
    },

    async peek(name): Promise<string | null> {
      return asString(await client.get(rev(name)));
    },

    async write(name, text, expect?: WriteExpectation) {
      if (expect === undefined) {
        /* Unconditional: take whatever is there. Still a script, so the
           revision moves with the body. */
        const got = await client.eval(
          `redis.call('SET', KEYS[1], ARGV[1]); return redis.call('INCR', KEYS[2])`,
          [body(name), rev(name)],
          [text]
        );
        return { version: asString(got) };
      }
      const got = await client.eval(
        CAS,
        [body(name), rev(name)],
        [expect.version ?? "", text]
      );
      if (Number(got) < 0) return false;
      return { version: asString(got) };
    },

    async exists(name) {
      return (await client.get(rev(name))) !== null;
    },
  };
}

/** The names the marketplace integration injects, either generation. */
export function redisEnv(): { url: string; token: string } | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}
