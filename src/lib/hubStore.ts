/**
 * Where the hub keeps its bytes.
 *
 * The board and the photos both need one durable place every device can
 * reach. On a Mac that is a directory. On a serverless host there is no such
 * thing: the filesystem is read-only outside `/tmp`, and `/tmp` belongs to a
 * single instance and dies with it. Both hubs wrote straight to `fs`, so a
 * Vercel deployment stored nothing — the board survived only in whichever
 * instance's memory happened to serve the request (which is why text sync
 * looked like it worked), and photos never crossed between devices at all,
 * because the photo hub had no such accident to fall back on.
 *
 * So the bytes go through a store. Three backends, chosen by what the host
 * actually offers and by what is being stored:
 *
 *   UPSTASH_REDIS_REST_URL set  →  Redis (hubRedis.ts), board and pictures
 *   else BLOB_READ_WRITE_TOKEN  →  Vercel Blob
 *   otherwise                   →  $SYNC_DATA_DIR (or `.data/`) on disk
 *
 * Why Redis holds the pictures too: a shrunk photo is a ~300 KB string,
 * fetched once per device and then cached in the browser, so a key-value
 * store is fine for it — and one free service beats a second one whose
 * quota already suspended the hub once. Blob stays as the file backend
 * for anyone deploying without Redis.
 *
 * Self-hosting on the Mac is unchanged and needs no token. Nothing is public:
 * the board is a person's notes and the photos are their photos, so every
 * blob is written `access: "private"` and read back through the SDK rather
 * than served from a URL that anyone holding it could fetch.
 *
 * `version` is an opaque compare-and-swap token. Blob hands back an ETag and
 * accepts `ifMatch`, so two instances racing to merge the same board cannot
 * silently overwrite each other. The filesystem backend is one machine whose
 * board writes are serialised in-process; its `local` token distinguishes an
 * existing file from an absent one so create-if-absent stays meaningful.
 */

import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Redis } from "@upstash/redis";
import { redisEnv, redisStore, type RedisLike } from "./hubRedis";

/** A stored value and the version to quote back on a conditional write. */
export type StoredValue = { body: string; version: string | null };

/** What a write expects to find already there: a specific version, or
    nothing at all (`version: null`). Omitted means "just write it". */
export type WriteExpectation = { version: string | null };

/** A write that went through, and the version it produced when the store
    can say (Redis can; Blob and disk cannot). */
export type Written = { version: string | null };

export type HubStore = {
  read(key: string): Promise<StoredValue | null>;
  /** The current version alone, without the body — what a poll needs.
      Optional: only a store where the version is cheap to read offers it. */
  peek?(key: string): Promise<string | null>;
  /** False when the expectation no longer holds — the caller re-reads and
      tries again. Any other failure throws, because a hub that cannot
      store must not report success. */
  write(
    key: string,
    body: string,
    expect?: WriteExpectation
  ): Promise<Written | false>;
  /** False only when the key is known to be absent. Storage failures throw. */
  exists(key: string): Promise<boolean>;
};

const DIR = process.env.SYNC_DATA_DIR || path.join(process.cwd(), ".data");

/** A filesystem miss is expected. Permission and I/O failures must surface. */
export function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export function fileStore(dir = DIR): HubStore {
  const fileFor = (key: string) => path.join(dir, key);
  return {
    async read(key) {
      try {
        return { body: await fs.readFile(fileFor(key), "utf8"), version: "local" };
      } catch {
        return null;
      }
    },
    /* One machine, and every read-modify-write is already serialised in
       process, so there is nothing to compare and swap against. */
    async write(key, body, expect) {
      const file = fileFor(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      /* Temp file then rename: a crash mid-write can never leave half a
          board — or half a photo — under a real name. */
      const tmp = `${file}.${randomUUID()}.tmp`;
      await fs.writeFile(tmp, body, "utf8");
      try {
        if (expect?.version === null) {
          /* A hard link publishes the complete temp file only when the real
             path is still absent. EEXIST means another writer won. */
          try {
            await fs.link(tmp, file);
          } catch (error) {
            if (
              error instanceof Error &&
              "code" in error &&
              (error as NodeJS.ErrnoException).code === "EEXIST"
            ) return false;
            throw error;
          }
        } else {
          await fs.rename(tmp, file);
        }
        return { version: "local" };
      } finally {
        await fs.rm(tmp, { force: true });
      }
    },
    async exists(key) {
      try {
        await fs.access(fileFor(key));
        return true;
      } catch (error) {
        if (isMissingFileError(error)) return false;
        throw error;
      }
    },
  };
}

/**
 * An ETag we can actually compare against.
 *
 * Blob returns a WEAK validator — `W/"abc"` — once an object is big enough
 * to be stored compressed, and `If-Match` is defined to use strong
 * comparison, so a weak tag never matches and the conditional write fails
 * forever. That is not theoretical: a small board got a strong tag and
 * synced fine, then crossed the size threshold, started coming back as
 * `W/"..."`, and every push after that failed silently for a day. The
 * prefix is a transport detail, not part of the identity — strip it and
 * the same value matches.
 */
export const strongEtag = (etag: string | null | undefined): string | null =>
  etag ? etag.replace(/^W\//, "") : null;

function blobStore(): HubStore {
  return {
    async read(key) {
      const { get, BlobNotFoundError } = await import("@vercel/blob");
      try {
        /* useCache: false — a hub that serves a cached board would hand a
           device state older than what it just pushed. */
        const res = await get(key, { access: "private", useCache: false });
        if (!res || res.statusCode !== 200) return null;
        return {
          body: await new Response(res.stream).text(),
          version: strongEtag(res.blob.etag),
        };
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
    },
    async write(key, body, expect) {
      const {
        put,
        head,
        BlobPreconditionFailedError,
        BlobNotFoundError,
        BlobError,
      } = await import("@vercel/blob");
      const guard =
        expect === undefined
          ? { allowOverwrite: true }
          : expect.version === null
            ? /* Only if nothing is there: whoever arrives second is told. */
              { allowOverwrite: false }
            : { ifMatch: expect.version };
      try {
        await put(key, body, {
          access: "private",
          addRandomSuffix: false,
          ...guard,
        });
        return { version: null };
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) return false;
        /* Blob uses a generic BlobError when allowOverwrite:false finds an
           existing path. Verify that path now exists before calling this a
           harmless concurrent winner; an outage must still throw. */
        if (expect?.version === null && error instanceof BlobError) {
          try {
            await head(key);
            return false;
          } catch (checkError) {
            if (checkError instanceof BlobNotFoundError) throw error;
            throw checkError;
          }
        }
        throw error;
      }
    },
    async exists(key) {
      const { head, BlobNotFoundError } = await import("@vercel/blob");
      try {
        await head(key);
        return true;
      } catch (error) {
        if (error instanceof BlobNotFoundError) return false;
        throw error;
      }
    },
  };
}

/** True when the host has given us a Blob store to write to. */
export function usingBlob(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/** True when the board has a Redis to live in. */
export function usingRedis(): boolean {
  return !!redisEnv();
}

let files: HubStore | null = null;
let filesForBlob: boolean | null = null;
let redis: HubStore | null = null;

/** Where bytes go without Redis: Blob when the host gave us one, else disk. */
function fileBackend(): HubStore {
  const blob = usingBlob();
  if (!files || filesForBlob !== blob) {
    files = blob ? blobStore() : fileStore();
    filesForBlob = blob;
  }
  return files;
}

/** The store this deployment should use. Re-resolved if the environment
    changes under it, which only really happens in tests. */
export function hubStore(): HubStore {
  const env = redisEnv();
  if (!env) return fileBackend();
  if (!redis) {
    const client = new Redis({ url: env.url, token: env.token });
    redis = redisStore(client as unknown as RedisLike);
  }
  return redis;
}
