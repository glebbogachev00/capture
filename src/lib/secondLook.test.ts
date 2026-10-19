import { describe, expect, it, vi } from "vitest";
import { acceptFiling, filingPrompt } from "./secondLook";
import { fileThoughts } from "./secondLook.server";
import type { SimpleSortItem } from "./simpleSort";

const threads = [
  { id: "rcg", name: "Reality Creation Game", about: "A personal practice built on attention and intention." },
  { id: "capture", name: "Capture.", about: "The notes app being built." },
];
const latest = { rcg: "Why do I keep coming back to the wind-up bird book?" };

describe("the second look before a new thread", () => {
  it("shows each thread with its latest note, and the note in its capture", () => {
    const prompt = filingPrompt("The wind-up bird points me somewhere.", "Fix the login. The wind-up bird points me somewhere.", threads, latest);
    expect(prompt).toContain('"latest":"Why do I keep coming back to the wind-up bird book?"');
    expect(prompt).toContain("The note to file (part of that capture):");
    expect(filingPrompt("Same.", "Same.", threads, {})).toContain("The note:\n\"Same.\"");
  });

  it("accepts only an existing thread; anything else keeps the new one", () => {
    expect(acceptFiling({ threadId: "rcg" }, threads)).toBe("rcg");
    expect(acceptFiling({ threadId: null }, threads)).toBeNull();
    expect(acceptFiling({ threadId: "made-up" }, threads)).toBeNull();
    expect(acceptFiling("nonsense", threads)).toBeNull();
  });

  it("asks only about thoughts that would start a new thread, and keeps them on any failure", async () => {
    const items: SimpleSortItem[] = [
      { kind: "thought", text: "Wind-up bird", threads: [{ name: "Wind-up Bird Chronicles" }] },
      { kind: "thought", text: "Login copy", threads: [{ id: "capture" }] },
      { kind: "action", text: "Fix the login" },
      { kind: "thought", text: "Something new", threads: [{ name: "Gardening" }] },
    ];
    const file = vi.fn(async (note: string) => {
      if (note === "Something new") throw new Error("provider down");
      return "rcg";
    });
    const out = await fileThoughts(items, { threads, latest }, file);
    expect(file.mock.calls.map(([note]) => note)).toEqual(["Wind-up bird", "Something new"]);
    expect(out.map((item) => item.threads)).toEqual([[{ id: "rcg" }], [{ id: "capture" }], undefined, [{ name: "Gardening" }]]);
  });
});
