import { describe, expect, it } from "vitest";
import { search } from "@/lib/search";
import type { Action, Board, Frag, Intention, Thread } from "@/lib/model";

function action(over: Partial<Action> = {}): Action {
  return {
    id: "a",
    text: "",
    done: false,
    at: 0,
    shelf: "days",
    expires: null,
    ...over,
  };
}

function frag(over: Partial<Frag> = {}): Frag {
  return { id: "f", at: 0, text: "", ...over };
}

function thread(over: Partial<Thread> = {}): Thread {
  return { id: "t", name: "", summary: "", frags: [], ...over };
}

function intention(over: Partial<Intention> = {}): Intention {
  return {
    id: "i",
    number: 1,
    rawInput: "",
    expandedIntention: "",
    recommendedActions: [],
    counterIntentions: [],
    at: 0,
    updatedAt: 0,
    ...over,
  };
}

function board(over: Partial<Board> = {}): Board {
  return {
    actions: [],
    threads: [],
    intentions: [],
    principles: [],
    ledger: [],
    ...over,
  };
}

describe("search", () => {
  it("returns no hits for an empty query", () => {
    const b = board({
      actions: [action({ text: "call dentist" })],
      threads: [thread({ name: "dentist trip" })],
      intentions: [intention({ expandedIntention: "I rewrite my dentist" })],
    });
    expect(search(b, "")).toEqual({
      actions: [],
      threads: [],
      intentions: [],
      total: 0,
    });
    expect(search(b, "   ")).toEqual({
      actions: [],
      threads: [],
      intentions: [],
      total: 0,
    });
  });

  it("requires every term to appear (AND), in any order", () => {
    const b = board({
      actions: [action({ text: "buy milk and eggs" })],
    });
    // All terms present → hit, order irrelevant.
    expect(search(b, "milk eggs")).toMatchObject({ total: 1 });
    expect(search(b, "eggs milk")).toMatchObject({ total: 1 });
    // Missing one term → no hit.
    expect(search(b, "milk bread")).toMatchObject({ total: 0 });
  });

  it("matches case-insensitively", () => {
    const b = board({
      actions: [action({ text: "Call the DENTIST" })],
    });
    expect(search(b, "DENTIST")).toMatchObject({ total: 1 });
    expect(search(b, "dentist")).toMatchObject({ total: 1 });
    expect(search(b, "Clinic")).toMatchObject({ total: 0 });
  });

  it("matches threads on name, summary, and returns the matching fragments", () => {
    const b = board({
      threads: [
        thread({
          name: "Garden plan",
          summary: "Spring planting",
          frags: [
            frag({ text: "tomatoes need sun" }),
            frag({ text: "basil by the door" }),
          ],
        }),
        thread({ name: "Books", summary: "", frags: [frag({ text: "tomatoes" })] }),
      ],
    });

    // Match on name only; no fragments matched.
    let r = search(b, "garden");
    expect(r.threads).toHaveLength(1);
    expect(r.threads[0].frags).toHaveLength(0);
    expect(r.total).toBe(1);

    // Match on summary only.
    r = search(b, "planting");
    expect(r.threads.map((t) => t.thread.id)).toEqual(["t"]);

    // Match on a fragment; frags carries the actual matching notes.
    r = search(b, "tomatoes");
    expect(r.threads).toHaveLength(2);
    const garden = r.threads.find((t) => t.thread.name === "Garden plan");
    expect(garden?.frags.map((f) => f.text)).toEqual(["tomatoes need sun"]);
    const books = r.threads.find((t) => t.thread.name === "Books");
    expect(books?.frags.map((f) => f.text)).toEqual(["tomatoes"]);
  });

  it("matches intentions across expandedIntention, rawInput, recommendedActions, counterIntentions", () => {
    const b = board({
      intentions: [
        intention({
          expandedIntention: "I am calm",
          rawInput: "stay calm",
          recommendedActions: ["breathe", "pause"],
          counterIntentions: ["rushing"],
        }),
      ],
    });

    expect(search(b, "calm")).toMatchObject({ total: 1 });
    expect(search(b, "breathe")).toMatchObject({ total: 1 });
    expect(search(b, "rushing")).toMatchObject({ total: 1 });
    expect(search(b, "whatever")).toMatchObject({ total: 0 });
  });

  it("matches actions on text and src", () => {
    const b = board({
      actions: [action({ text: "send invoice", src: "email from client" })],
    });
    expect(search(b, "invoice")).toMatchObject({ total: 1 });
    expect(search(b, "client")).toMatchObject({ total: 1 });
  });
});
