import { expect, it } from "vitest";
import { buildBackup, restoreBackup } from "./backup";
import { handleCloudBoardPut, type CloudBoardDocument, type CloudBoardRepository } from "./cloudBoard";
import { EMPTY, hydrate, KEY, type Board } from "./model";

it("allows a fresh explicit archive recovery after reset without replaying the old operation", async () => {
  // Real Restore, hydration and Cloud PUT; only the persistence/auth providers
  // are local substitutes. A serialized pending board models a lost response
  // followed by reload, not a second user-authorized Restore invocation.
  let document: CloudBoardDocument | null = null;
  const repository: CloudBoardRepository = {
    async get() { return document; },
    async create(_owner, state) {
      if (document) return null;
      return document = { state, rev: 1 };
    },
    async update(_owner, expectedRev, state) {
      if (!document || document.rev !== expectedRev) return null;
      return document = { state, rev: expectedRev + 1 };
    },
  };
  const put = async (board: Board): Promise<Board> => {
    const response = await handleCloudBoardPut(new Request("https://capture.test/api/cloud/board", {
      method: "PUT", headers: { "X-Capture-Owner": "alice" },
      body: JSON.stringify({ board, tombstones: [] }),
    }), {
      isEnabled: () => true, verifyIdentity: async () => ({ userId: "alice" }),
      requiresEntitlement: () => false, repository,
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect((await repository.get("alice"))?.state.board).toEqual(result.board);
    return result.board;
  };
  const reload = (board: Board) => hydrate(JSON.parse(JSON.stringify(board)));
  const history = (board: Board) => ({
    ledger: board.ledger, corrections: board.corrections,
    wraps: board.wraps, completions: board.completions,
  });
  const emptyHistory = { ledger: [], corrections: [], wraps: [], completions: [] };
  const source: Board = {
    ...EMPTY,
    ledger: [{ id: "capture", at: 1, raw: "original", clean: "original", kind: "action", source: "typed", targetId: "a" }],
    corrections: [{ id: "correction", at: 2, proposalKind: "undone", accepted: false, context: "original correction" }],
    completions: [{ id: "a", at: 3, text: "original completion" }],
    wraps: [{ day: "2026-09-01", at: 4, line: "original wrap", insights: [], tomorrow: "",
      stats: { day: "2026-09-01", said: 1, threadsMoved: 0, actionsMade: 1, intentions: 0,
        threads: [], firstAt: 1, lastAt: 1, returns: [], finished: [] } }],
  };
  const archive = { ...buildBackup(source), deviceSnapshot: {
    version: 1, id: "same-original-archive", entries: [[KEY, JSON.stringify(source)]],
  } };
  await put({ ...EMPTY, historyEpoch: 100 });
  const firstOperation = restoreBackup(archive, { ...EMPTY, historyEpoch: 100 }).board;
  const pendingRetry = reload(firstOperation);
  expect(pendingRetry.historyImports).toEqual(firstOperation.historyImports);
  const accepted = await put(firstOperation);
  for (const records of Object.values(history(accepted))) expect(records).toHaveLength(1);
  for (const status of Object.values(accepted.historyImports!)) expect(status).toBe("accepted");
  expect(history(await put(pendingRetry))).toEqual(history(accepted));

  const reset = await put({ ...accepted, ...emptyHistory, historyEpoch: 200 });
  expect(history(reset)).toEqual(emptyHistory);
  expect(history(await put(pendingRetry))).toEqual(emptyHistory);
  expect(history(await put(reload(accepted)))).toEqual(emptyHistory);

  // Another device has not downloaded epoch 200 or the old receipt. Choosing
  // the SAME file again is new authorization, not a retry of firstOperation.
  const freshOperation = restoreBackup(archive, EMPTY).board;
  const freshRetry = reload(freshOperation);
  for (const records of Object.values(history(freshOperation))) expect(records).toHaveLength(1);
  const recovered = await put(freshOperation);
  for (const records of Object.values(history(recovered))) expect(records).toHaveLength(1);
  expect(recovered.historyEpoch).toBe(200);
  expect(freshOperation.ledger![0].importBatch).not.toBe(firstOperation.ledger![0].importBatch);
  expect(history(await put(freshRetry))).toEqual(history(recovered));
  expect(history(await put(reload(recovered)))).toEqual(history(recovered));
  expect(history(await put(pendingRetry))).toEqual(history(recovered));

  // The fresh operation becomes stale too after the next genuine reset.
  await put({ ...recovered, ...emptyHistory, historyEpoch: 300 });
  expect(history(await put(freshRetry))).toEqual(emptyHistory);
  expect(history(await put(pendingRetry))).toEqual(emptyHistory);
});
