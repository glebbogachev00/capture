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
 * So the bytes go through a store. Two backends, chosen by what the host
 * actually offers:
 *
 *   BLOB_READ_WRITE_TOKEN set  →  Vercel Blob
 *   otherwise                  →  $SYNC_DATA_DIR (or `.data/`) on disk
 *
 * Self-hosting on the Mac is unchanged and needs no token. Nothing is public:
 * the board is a person's notes and the photos are their photos, so every
 * blob is written `access: "private"` and read back through the SDK rather
 * than served from a URL that anyone holding it could fetch.
 *
 * `version` is an opaque compare-and-swap token. Blob hands back an ETag and
 * accepts `ifMatch`, so two instances racing to merge the same board cannot
 * silently overwrite each other. The filesystem backend is one machine whose
 * writes are already serialised in-process, so it has no version to give and
 * accepts every write.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

/** A stored value and the version to quote back on a conditional write. */
export type StoredValue = { body: string; version: string | null };

/** What a write expects to find already there: a specific version, or
    nothing at all (`version: null`). Omitted means "just write it". */
export type WriteExpectation = { version: string | null };

export type HubStore = {
  read(key: string): Promise<StoredValue | null>;
  /** False when the expectation no longer holds — the caller re-reads and
      tries again. Any other failure throws, because a hub that cannot
      store must not report success. */
  write(
    key: string,
    body: string,
    expect?: WriteExpectation
  ): Promise<boolean>;
  exists(key: string): Promise<boolean>;
};

const DIR = process.env.SYNC_DATA_DIR || path.join(process.cwd(), ".data");

function fileStore(): HubStore {
  const fileFor = (key: string) => path.join(DIR, key);
  return {
    async read(key) {
      try {
        return { body: await fs.readFile(fileFor(key), "utf8"), version: null };
      } catch {
        return null;
      }
    },
    /* One machine, and every read-modify-write is already serialised in
       process, so there is nothing to compare and swap against. */
    async write(key, body) {
      const file = fileFor(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      /* Temp file then rename: a crash mid-write can never leave half a
         board — or half a photo — under a real name. */
      const tmp = file + ".tmp";
      await fs.writeFile(tmp, body, "utf8");
      await fs.rename(tmp, file);
      return true;
    },
    async exists(key) {
      try {
        await fs.access(fileFor(key));
        return true;
      } catch {
        return false;
      }
    },
  };
}

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
          version: res.blob.etag,
        };
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
    },
    async write(key, body, expect) {
      const { put, BlobPreconditionFailedError, BlobError } = await import(
        "@vercel/blob"
      );
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
        return true;
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) return false;
        /* allowOverwrite:false against a blob that now exists — another
           instance created it first, which is the same answer. */
        if (expect?.version === null && error instanceof BlobError) return false;
        throw error;
      }
    },
    async exists(key) {
      const { head } = await import("@vercel/blob");
      try {
        await head(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** True when the host has given us a Blob store to write to. */
export function usingBlob(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

let cached: HubStore | null = null;
let cachedForBlob: boolean | null = null;

/** The store this deployment should use. Re-resolved if the environment
    changes under it, which only really happens in tests. */
export function hubStore(): HubStore {
  const blob = usingBlob();
  if (!cached || cachedForBlob !== blob) {
    cached = blob ? blobStore() : fileStore();
    cachedForBlob = blob;
  }
  return cached;
}
