import { describe, expect, it } from "vitest";
import type { Thread } from "./model";
import { parseProfileIdentity, recurringThreads } from "./profile";

const thread = (name: string, layers: number, lastAt: number): Thread => ({
  id: name,
  name,
  summary: "",
  frags: Array.from({ length: layers }, (_, i) => ({
    id: `${name}-${i}`,
    at: i === layers - 1 ? lastAt : i,
    text: `${name} ${i}`,
  })),
});

describe("parseProfileIdentity", () => {
  it("uses explicit defaults when no saved profile exists", () => {
    expect(
      parseProfileIdentity(null, {
        name: "Gleb",
        image: "/gleb.jpg",
      })
    ).toEqual({ name: "Gleb", image: "/gleb.jpg" });
  });
});

describe("recurringThreads", () => {
  it("prefers deeper threads and uses recency to break ties", () => {
    const result = recurringThreads(
      [
        thread("shallow", 2, 500),
        thread("older deep", 5, 100),
        thread("newer deep", 5, 700),
        thread("middle", 3, 900),
      ],
      3
    );

    expect(result.map((item) => item.name)).toEqual([
      "newer deep",
      "older deep",
      "middle",
    ]);
  });
});
