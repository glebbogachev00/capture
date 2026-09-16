// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { EMPTY, IMG, sweep } from "./model";
import { get, set } from "./storage";

it.each(["done", "faded"])("startup %s cleanup retains bytes referenced by the Record and other board items", async kind => {
  await set(IMG("shared"), "original photo");
  const old = { shelf: "keep" as const, expires: null, id: "old", text: "old", at: 1, imgs: ["shared"], done: kind === "done", doneAt: 1, faded: kind === "faded", fadedAt: 1 };
  const board = { ...EMPTY, actions: [old], ledger: [{ id: "receipt", targetId: "old", at: 1, raw: "old", clean: "old", kind: "action" as const, source: "typed" as const, imgs: ["shared"] }], profile: { name: "Me", imageId: "shared" } };
  const result = await sweep(board);
  expect(result.next.actions).toEqual([]);
  expect(await get(IMG("shared"))).toBe("original photo");
});
