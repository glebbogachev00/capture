import { expect, it } from "vitest";
import { buildBackup, restoreBackup } from "./backup";
import { EMPTY, hydrate, KEY } from "./model";
import { mergeBoards } from "./sync";

it("restores original unknown board and profile fields through normal restore and hydration", () => {
  const original = { ...EMPTY, futureField: { untouched: [1, "original"] }, profile: { name: "Earlier", futureProfile: { color: "blue" } } };
  const deviceSnapshot = { version: 1, id: "archive", entries: [[KEY, JSON.stringify(original)], ["capture:future-device-setting", "opaque-original"]] };
  const download = { ...buildBackup(original), deviceSnapshot };
  const restored = hydrate(JSON.parse(JSON.stringify(restoreBackup(download, EMPTY).board)));
  expect(restored).toMatchObject({ futureField: original.futureField, profile: original.profile });
  expect(download.deviceSnapshot).toEqual(deviceSnapshot);
});
it.each([[100, 0], [0, 100]])("original archive recovery retains all history without exporting its source reset epoch (%s -> %s)", (sourceEpoch, destinationEpoch) => {
  const ledger = Array.from({ length: 501 }, (_, i) => ({ id: `source-${i}`, at: i, raw: "source", clean: "source", kind: "action" as const, source: "typed" as const, targetId: "a" }));
  const original = { ...EMPTY, ledger, historyEpoch: sourceEpoch };
  const archive = { ...buildBackup(original), deviceSnapshot: { version: 1, id: "snapshot", entries: [[KEY, JSON.stringify(original)]] } };
  const restored = restoreBackup(archive, EMPTY).board;
  expect(restored.ledger).toHaveLength(501);
  const destination = { ...EMPTY, historyEpoch: destinationEpoch, ledger: [{ ...ledger[0], id: "destination", raw: "destination" }] };
  const merged = mergeBoards(restored, destination);
  expect(merged.ledger).toHaveLength(502);
  expect(merged.historyEpoch).toBe(destinationEpoch);
});
it("keeps destination conflicts without replacing the account profile", () => {
  const original = { ...EMPTY, futureField: "source", profile: { name: "Earlier", futureProfile: "source" } };
  const destination = { ...EMPTY, futureField: "destination", profile: { name: "Account" } };
  expect(restoreBackup(buildBackup(original), destination).board).toMatchObject({ futureField: "destination", profile: { name: "Account" } });
});
