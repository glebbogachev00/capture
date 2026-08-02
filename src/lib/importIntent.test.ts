import { describe, expect, it } from "vitest";
import { importIntentBackup } from "@/lib/importIntent";
import type { Board } from "@/lib/model";

function board(over: Partial<Board> = {}): Board {
  return {
    actions: [],
    threads: [],
    intentions: [],
    principles: [],
    ...over,
  };
}

describe("importIntentBackup", () => {
  it("throws when the file is not an intent backup", () => {
    expect(() => importIntentBackup({ app: "x" }, board({}))).toThrow(
      /intentions/
    );
    expect(() => importIntentBackup(null, board({}))).toThrow(/intentions/);
  });

  it("converts ISO dates to epoch ms", () => {
    const r = importIntentBackup(
      {
        intentions: [
          {
            id: "i1",
            rawInput: "stay",
            expandedIntention: "I am calm",
            dateCreated: "2026-01-01T00:00:00.000Z",
            dateUpdated: "2026-01-02T00:00:00.000Z",
          },
        ],
      },
      board({})
    );

    expect(r.added).toBe(1);
    const i = r.board.intentions[0];
    expect(i.at).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    expect(i.updatedAt).toBe(Date.parse("2026-01-02T00:00:00.000Z"));
  });

  it("dedupes by id: importing twice adds nothing", () => {
    const backup = {
      intentions: [{ id: "i1", expandedIntention: "I am calm" }],
    };
    const first = importIntentBackup(backup, board({}));
    expect(first.added).toBe(1);

    const second = importIntentBackup(backup, first.board);
    expect(second.added).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(second.board.intentions).toHaveLength(1);
  });

  it("renumbers records without a number", () => {
    const r = importIntentBackup(
      {
        intentions: [
          { id: "a", expandedIntention: "one" },
          { id: "b", expandedIntention: "two" },
          { id: "c", number: 7, expandedIntention: "three" },
          { id: "d", expandedIntention: "four" },
        ],
      },
      board({})
    );

    const byId = Object.fromEntries(r.board.intentions.map((i) => [i.id, i.number]));
    expect(byId.a).toBe(1);
    expect(byId.b).toBe(2);
    expect(byId.c).toBe(7); // carried over
    // Renumbering continues after the highest number seen, including carried.
    expect(byId.d).toBe(8);
  });

  it("counts and skips malformed records (missing id or expandedIntention)", () => {
    const r = importIntentBackup(
      {
        intentions: [
          { id: "a", expandedIntention: "good" },
          { id: "b" },
          { expandedIntention: "no id" },
          {},
        ],
      },
      board({})
    );
    expect(r.added).toBe(1);
    expect(r.malformed).toBe(3);
    expect(r.board.intentions).toHaveLength(1);
  });

  it("brings custom principles across and skips builtins matched by name", () => {
    const existing = board({ principles: [{ id: "seed", name: "Simplify" } as never] });

    const r = importIntentBackup(
      {
        principles: [
          { id: "p1", name: "Simplify", description: "builtin dup" },
          { id: "p2", name: "My Custom", description: "custom" },
        ],
        intentions: [],
      },
      existing
    );

    expect(r.principlesAdded).toBe(1);
    const names = r.board.principles.map((p) => p.name);
    expect(names).toEqual(["Simplify", "My Custom"]);
    const custom = r.board.principles.find((p) => p.name === "My Custom");
    expect(custom?.description).toBe("custom");
  });

  it("reports correct counts fields", () => {
    const r = importIntentBackup(
      {
        intentions: [
          { id: "a", expandedIntention: "one" },
          { id: "b", expandedIntention: "two" },
          { id: "c" },
        ],
      },
      board({})
    );
    expect(r.added).toBe(2);
    expect(r.duplicates).toBe(0);
    expect(r.malformed).toBe(1);
    expect(r.principlesAdded).toBe(0);
  });
});
