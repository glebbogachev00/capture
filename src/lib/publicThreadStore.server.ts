import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isCloudEnabled } from "@/lib/cloudBoard";
import type { CloudServerClient } from "@/lib/cloudRequestGuard.server";
import type { OwnedPublicThread, PublicThread, PublicThreadInput } from "@/lib/publicThread";
import { getCloudConfig } from "@/lib/supabase/config";

/**
 * Where public snapshots live. Public data is a separate table (Cloud) or a
 * separate file (local preview), never the board, so a public read has no
 * path to private records.
 */
export interface PublicThreadStore {
  /** Anonymous: one snapshot by exact token, public fields only. */
  read(token: string): Promise<PublicThread | null>;
  list(owner: string): Promise<OwnedPublicThread[]>;
  create(owner: string, token: string, input: PublicThreadInput): Promise<OwnedPublicThread>;
  /** null when the token is not this owner's. */
  update(owner: string, token: string, input: PublicThreadInput): Promise<OwnedPublicThread | null>;
  remove(owner: string, token: string): Promise<boolean>;
}

export class TokenTakenError extends Error {}

/** Cloud serves public links; a development-only preview may stand in for it
 * so the flow can be tried without a hosted database. Everything else: off. */
export function publicThreadMode(env: Record<string, string | undefined> = process.env): "cloud" | "preview" | "off" {
  if (isCloudEnabled(env)) return "cloud";
  if (env.NODE_ENV !== "production" && env.CAPTURE_PUBLISH_PREVIEW_DIR?.trim()) return "preview";
  return "off";
}

type Row = {
  token: string;
  title: string;
  intro: string | null;
  byline: string | null;
  fragments: unknown;
  published_at: string;
  updated_at: string;
  source_key?: string;
};

const PUBLIC_COLUMNS = "token, title, intro, byline, fragments, published_at, updated_at";

function fromRow(row: Row): PublicThread {
  const fragments = Array.isArray(row.fragments)
    ? row.fragments.flatMap((fragment) =>
        fragment && typeof fragment === "object" && typeof (fragment as { text?: unknown }).text === "string"
          ? [{ text: (fragment as { text: string }).text }]
          : [])
    : [];
  return {
    token: row.token,
    title: row.title,
    intro: row.intro,
    byline: row.byline,
    fragments,
    publishedAt: new Date(row.published_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const content = (input: PublicThreadInput) => ({
  title: input.title,
  intro: input.intro,
  byline: input.byline,
  fragments: input.fragments.map(({ text }) => ({ text })),
});

/** Owner reads and writes go through the caller's cookie-bound client, so
 * row-level security, not this code, decides whose rows they can touch. */
export function supabasePublicThreadStore(client: CloudServerClient | null): PublicThreadStore {
  const config = getCloudConfig();
  if (!config || config.status !== "ready") throw new Error("cloud is not configured");
  const owned = () => {
    if (!client) throw new Error("cloud is not configured");
    return client.from("capture_public_threads");
  };
  return {
    async read(token) {
      const anon = createClient(config.url, config.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await anon.rpc("capture_public_thread", { p_token: token });
      if (error) throw new Error("public thread unavailable");
      const row = Array.isArray(data) ? (data[0] as Row | undefined) : undefined;
      return row ? fromRow(row) : null;
    },
    async list(owner) {
      const { data, error } = await owned()
        .select(`${PUBLIC_COLUMNS}, source_key`)
        .eq("owner_id", owner)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw new Error("public threads unavailable");
      return ((data ?? []) as Row[]).map((row) => ({ ...fromRow(row), sourceKey: row.source_key ?? "" }));
    },
    async create(owner, token, input) {
      const { data, error } = await owned()
        .insert({ owner_id: owner, token, source_key: input.sourceKey, ...content(input) })
        .select(`${PUBLIC_COLUMNS}, source_key`)
        .single();
      if (error?.code === "23505") throw new TokenTakenError();
      if (error || !data) throw new Error("publish failed");
      const row = data as Row;
      return { ...fromRow(row), sourceKey: row.source_key ?? "" };
    },
    async update(owner, token, input) {
      const { data, error } = await owned()
        .update(content(input))
        .eq("owner_id", owner)
        .eq("token", token)
        .select(`${PUBLIC_COLUMNS}, source_key`)
        .maybeSingle();
      if (error) throw new Error("update failed");
      if (!data) return null;
      const row = data as Row;
      return { ...fromRow(row), sourceKey: row.source_key ?? "" };
    },
    async remove(owner, token) {
      const { data, error } = await owned().delete().eq("owner_id", owner).eq("token", token).select("token");
      if (error) throw new Error("unpublish failed");
      return Array.isArray(data) && data.length > 0;
    },
  };
}

type PreviewRow = OwnedPublicThread & { owner: string };

/** Development preview only: one JSON file, owners enforced in code. */
export function filePublicThreadStore(dir: string): PublicThreadStore {
  const file = path.join(dir, "public-threads.json");
  const load = async (): Promise<PreviewRow[]> => {
    try {
      const value = JSON.parse(await readFile(file, "utf8"));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };
  const save = async (rows: PreviewRow[]) => {
    await mkdir(dir, { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(rows, null, 2));
    await rename(temp, file);
  };
  const publicOnly = (row: PreviewRow): PublicThread => ({
    token: row.token, title: row.title, intro: row.intro, byline: row.byline,
    fragments: row.fragments, publishedAt: row.publishedAt, updatedAt: row.updatedAt,
  });
  const ownedOnly = (row: PreviewRow): OwnedPublicThread => ({ ...publicOnly(row), sourceKey: row.sourceKey });
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };
  return {
    async read(token) {
      const row = (await load()).find((entry) => entry.token === token);
      return row ? publicOnly(row) : null;
    },
    async list(owner) {
      return (await load()).filter((entry) => entry.owner === owner)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(ownedOnly);
    },
    create: (owner, token, input) => serial(async () => {
      const rows = await load();
      if (rows.some((entry) => entry.token === token)) throw new TokenTakenError();
      const now = new Date().toISOString();
      const row: PreviewRow = { owner, token, sourceKey: input.sourceKey, ...content(input), publishedAt: now, updatedAt: now };
      await save([...rows, row]);
      return ownedOnly(row);
    }),
    update: (owner, token, input) => serial(async () => {
      const rows = await load();
      const index = rows.findIndex((entry) => entry.token === token && entry.owner === owner);
      if (index < 0) return null;
      const row = { ...rows[index], ...content(input), updatedAt: new Date().toISOString() };
      rows[index] = row;
      await save(rows);
      return ownedOnly(row);
    }),
    remove: (owner, token) => serial(async () => {
      const rows = await load();
      const kept = rows.filter((entry) => !(entry.token === token && entry.owner === owner));
      if (kept.length === rows.length) return false;
      await save(kept);
      return true;
    }),
  };
}
