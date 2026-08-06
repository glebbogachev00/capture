import { describe, expect, it } from "vitest";
import type { Board, Frag, Thread } from "./model";
import {
  activeFoldedSources,
  foldThread,
  restoreFoldedThread,
} from "./threadFold";

const frag = (id: string, at: number, text = id): Frag => ({ id, at, text });

const thread = (
  id: string,
  name: string,
  frags: Frag[],
  summary = `${name} summary`
): Thread => ({ id, name, summary, frags });

const board = (threads: Thread[]): Board => ({
  actions: [],
  threads,
  intentions: [],
  principles: [],
  ledger: [],
});

describe("foldThread", () => {
  it("keeps every fragment and a complete restorable source snapshot", () => {
    const source = thread("source", "Earlier thread", [
      frag("f1", 10, "earlier detail"),
      frag("f3", 30, "later detail"),
    ]);
    const destination = thread("destination", "Main thread", [
      frag("f2", 20, "middle detail"),
    ]);

    const folded = foldThread(board([destination, source]), "destination", "source", 50);
    expect(folded.threads.map((t) => t.id)).toEqual(["destination"]);
    expect(folded.threads[0]?.frags.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
    expect(folded.threads[0]?.foldedFrom).toEqual([
      {
        id: "source",
        name: "Earlier thread",
        summary: "Earlier thread summary",
        frags: source.frags,
        foldedAt: 50,
      },
    ]);
  });
});

describe("restoreFoldedThread", () => {
  it("recreates the source and keeps edits made after the fold", () => {
    const source = thread("source", "Earlier thread", [
      frag("f1", 10, "original wording"),
    ]);
    const destination = thread("destination", "Main thread", [frag("f2", 20)]);
    const folded = foldThread(board([destination, source]), "destination", "source", 50);
    folded.threads[0].frags = folded.threads[0].frags.map((f) =>
      f.id === "f1" ? { ...f, text: "edited after folding", updatedAt: 70 } : f
    );

    const restored = restoreFoldedThread(folded, "destination", "source", 100);
    expect(restored.threads.map((t) => t.id)).toEqual(["destination", "source"]);
    expect(restored.threads[0]?.frags.map((f) => f.id)).toEqual(["f2"]);
    expect(activeFoldedSources(restored.threads[0])).toEqual([]);
    expect(restored.threads[0]?.foldedFrom?.[0]).toMatchObject({
      id: "source",
      foldedAt: 50,
      restoredAt: 100,
    });
    expect(restored.threads[1]).toMatchObject({
      id: "source",
      name: "Earlier thread",
      summary: "",
      updatedAt: 100,
    });
    expect(restored.threads[1]?.frags).toEqual([
      {
        id: "f1",
        at: 10,
        text: "edited after folding",
        updatedAt: 100,
      },
    ]);

    const refolded = foldThread(
      restored,
      "destination",
      "source",
      150
    );
    expect(activeFoldedSources(refolded.threads[0])).toHaveLength(1);
    expect(activeFoldedSources(refolded.threads[0])[0]).toMatchObject({
      id: "source",
      foldedAt: 150,
      restoredAt: 100,
    });
  });
});
