import { hydrate, type Board } from "@/lib/model";
import type { SyncState, Tombstone } from "@/lib/sync";
import type { CloudBoardDocument, CloudBoardRepository as RepositoryContract } from "@/lib/cloudBoard";

export type SupabaseQuery = {
  select(columns?: string): SupabaseQuery;
  insert(values: unknown): SupabaseQuery;
  update(values: unknown): SupabaseQuery;
  eq(column: string, value: string | number): SupabaseQuery;
  maybeSingle(): Promise<{ data: unknown; error: ProviderError | null }>;
};
export type SupabaseQueryClient = { from(table: string): SupabaseQuery };
type ProviderError = { code?: string; message?: string };

type BoardRow = { user_id: unknown; board: unknown; tombstones: unknown; rev: unknown };

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validBoard(value: unknown): value is Partial<Board> {
  return object(value) && (!("actions" in value) || Array.isArray(value.actions)) && (!("threads" in value) || Array.isArray(value.threads));
}

function validTombstones(value: unknown): value is Tombstone[] {
  return Array.isArray(value) && value.every((item) => {
    if (!object(item)) return false;
    return typeof item.id === "string" && typeof item.deletedAt === "number" && Number.isFinite(item.deletedAt) &&
      ["action", "thread", "frag", "intention", "principle"].includes(item.kind as string);
  });
}

function hydrateRow(value: unknown, expectedUserId?: string): CloudBoardDocument | null {
  if (!object(value)) return null;
  const row = value as BoardRow;
  if (typeof row.user_id !== "string" || !row.user_id || !validBoard(row.board) || !validTombstones(row.tombstones)) return null;
  if (expectedUserId !== undefined && row.user_id !== expectedUserId) return null;
  if (typeof row.rev !== "number" || !Number.isSafeInteger(row.rev) || row.rev < 1) return null;
  return { state: { board: hydrate(row.board), tombstones: row.tombstones as SyncState["tombstones"] }, rev: row.rev };
}

function providerFailure(): Error {
  return new Error("Cloud provider operation failed");
}

function acceptedRow(data: unknown, expectedUserId: string): CloudBoardDocument | null {
  if (data === null) return null;
  const document = hydrateRow(data, expectedUserId);
  if (!document) throw providerFailure();
  return document;
}

export class CloudBoardRepository implements RepositoryContract {
  constructor(private readonly client: SupabaseQueryClient) {}

  async get(userId: string): Promise<CloudBoardDocument | null> {
    const { data, error } = await this.client.from("capture_boards").select("user_id, board, tombstones, rev").eq("user_id", userId).maybeSingle();
    if (error) throw providerFailure();
    return acceptedRow(data, userId);
  }

  async create(userId: string, state: SyncState): Promise<CloudBoardDocument | null> {
    const { data, error } = await this.client.from("capture_boards").insert({ user_id: userId, board: state.board, tombstones: state.tombstones, rev: 1 }).select("user_id, board, tombstones, rev").maybeSingle();
    if (error?.code === "23505") return null;
    if (error) throw providerFailure();
    return acceptedRow(data, userId);
  }

  async update(userId: string, expectedRev: number, state: SyncState): Promise<CloudBoardDocument | null> {
    const { data, error } = await this.client.from("capture_boards").update({
      board: state.board,
      tombstones: state.tombstones,
      rev: expectedRev + 1,
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("rev", expectedRev).select("user_id, board, tombstones, rev").maybeSingle();
    if (error) throw providerFailure();
    return acceptedRow(data, userId);
  }
}

export { hydrateRow };
