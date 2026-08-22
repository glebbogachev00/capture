import { describe, expect, it } from "vitest";
import { redisStore, type RedisLike } from "./hubRedis";

/**
 * A Redis in a Map — enough of the real thing for the hub's script.
 * The CAS script is reproduced in JavaScript so the test checks the
 * CONTRACT the store relies on (compare, set, increment, or refuse), not
 * the Lua text.
 */
function fakeRedis(): RedisLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    async mget(...keys) {
      return keys.map((k) => (store.has(k) ? store.get(k)! : null));
    },
    async eval(script, keys, args) {
      const [bodyKey, revKey] = keys;
      const incr = () => {
        const n = Number(store.get(revKey) ?? 0) + 1;
        store.set(revKey, String(n));
        return n;
      };
      if (script.includes("local seen")) {
        const cur = store.has(revKey) ? store.get(revKey)! : null;
        const seen = String(args[0]);
        if ((cur === null && seen === "") || (cur !== null && cur === seen)) {
          store.set(bodyKey, String(args[1]));
          return incr();
        }
        return -1;
      }
      store.set(bodyKey, String(args[0]));
      return incr();
    },
  };
}

describe("the hub on Redis", () => {
  it("reads nothing from an empty store", async () => {
    const s = redisStore(fakeRedis());
    expect(await s.read("sync.json")).toBeNull();
    expect(await s.peek!("sync.json")).toBeNull();
    expect(await s.exists("sync.json")).toBe(false);
  });

  it("a first write needs nothing to be there, and hands back its revision", async () => {
    const s = redisStore(fakeRedis());
    const out = await s.write("sync.json", '{"rev":1}', { version: null });
    expect(out).toEqual({ version: "1" });
    expect(await s.read("sync.json")).toEqual({ body: '{"rev":1}', version: "1" });
  });

  it("a first write is refused once something is there", async () => {
    /* Two instances creating the hub at once: whoever is second is told. */
    const s = redisStore(fakeRedis());
    await s.write("sync.json", "a", { version: null });
    expect(await s.write("sync.json", "b", { version: null })).toBe(false);
  });

  it("compare-and-swap: the write that saw the current revision wins", async () => {
    const s = redisStore(fakeRedis());
    await s.write("sync.json", "a", { version: null });
    const { version } = (await s.read("sync.json"))!;
    expect(await s.write("sync.json", "b", { version })).toEqual({ version: "2" });
    /* The loser quoted the old revision. */
    expect(await s.write("sync.json", "c", { version })).toBe(false);
    expect((await s.read("sync.json"))!.body).toBe("b");
  });

  it("peek reads the revision without the document", async () => {
    const r = fakeRedis();
    const s = redisStore(r);
    await s.write("sync.json", "x".repeat(10_000), { version: null });
    expect(await s.peek!("sync.json")).toBe("1");
    /* The body key was never asked for. */
    let touched: string[] = [];
    const orig = r.mget.bind(r);
    r.mget = async (...keys) => {
      touched = keys;
      return orig(...keys);
    };
    await s.peek!("sync.json");
    expect(touched).toEqual([]);
  });

  it("hands JSON back as text even if the client parsed it", async () => {
    /* @upstash/redis deserialises JSON-looking values on read. */
    const r = fakeRedis();
    const s = redisStore({
      ...r,
      async mget(...keys) {
        const [doc, rev] = await r.mget(...keys);
        return [typeof doc === "string" ? JSON.parse(doc) : doc, rev];
      },
    });
    await s.write("sync.json", '{"rev":3,"board":{}}', { version: null });
    const out = await s.read("sync.json");
    expect(JSON.parse(out!.body)).toEqual({ rev: 3, board: {} });
  });
});
