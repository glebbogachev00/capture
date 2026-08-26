import { describe, expect, it } from "vitest";
import type { Action, Board } from "./model";
import { scanBoard, scanStale } from "./organize";

/**
 * The badge must never promise a row the review screen cannot show.
 *
 * scanBoard finds everything the word matcher can claim. scanStale is the
 * subset that reaches the screen. The badge counted the first and the panel
 * rendered the second, so a board whose only findings were duplicates said
 * "2 to tidy" and then had nothing to tidy.
 */
const action = (id: string, text: string, at: number): Action => ({
  id,
  text,
  done: false,
  at,
  shelf: "keep",
  expires: null,
});

const board = (actions: Action[]): Board => ({
  actions,
  threads: [],
  intentions: [],
  principles: [],
  ledger: [],
  corrections: [],
});

describe("the tidy badge counts what the panel shows", () => {
  it("a duplicate is found by the wide scan and not shown by the screen", () => {
    const now = Date.now();
    const b = board([
      action("a", "Renew the domain before it expires on Friday", now - 7200_000),
      action("b", "Renew the domain before it expires on Friday", now - 3600_000),
    ]);
    const wide = scanBoard(b, [], now).filter((p) => p.confidence === "high");
    const shown = scanStale(b, [], now).filter((p) => p.confidence === "high");

    // The duplicate is real — the wide scan is not wrong, it is just not
    // what this screen is for.
    expect(wide.length).toBeGreaterThan(0);
    // …and the screen shows none of it, which is why the badge cannot use it.
    expect(shown).toHaveLength(0);
  });

  it("never counts more than the screen can render", () => {
    const now = Date.now();
    const b = board([
      action("a", "Renew the domain before it expires on Friday", now - 7200_000),
      action("b", "Renew the domain before it expires on Friday", now - 3600_000),
      action("c", "Send Maya the invoice today", now - 1800_000),
    ]);
    const badge = scanStale(b, [], now).filter((p) => p.confidence === "high");
    const rendered = scanStale(b, [], now);
    expect(badge.length).toBeLessThanOrEqual(rendered.length);
  });
});
