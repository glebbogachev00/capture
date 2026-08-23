import { describe, expect, it } from "vitest";
import { splitNext } from "./nextStep";

describe("a thread's next step", () => {
  it("takes the NEXT line off the end of the prose", () => {
    const out = splitNext(
      "The pricing debate is still open.\n\nSeats are simpler.\n\nNEXT: Ask three small-team customers which they would pick."
    );
    expect(out.summary).toBe("The pricing debate is still open.\n\nSeats are simpler.");
    expect(out.next).toBe("Ask three small-team customers which they would pick.");
  });

  it("'none' is no step, and so is a missing line", () => {
    expect(splitNext("Still thinking.\nNEXT: none").next).toBeNull();
    expect(splitNext("Still thinking.\nNext: None.").next).toBeNull();
    expect(splitNext("Still thinking.")).toEqual({ summary: "Still thinking.", next: null });
  });

  it("tolerates markdown and quotes around the line", () => {
    expect(splitNext('Prose.\n**NEXT:** "Book the call"').next).toBe("Book the call");
  });

  it("keeps a step to one line", () => {
    const long = "NEXT: " + "do the thing ".repeat(30);
    expect(splitNext("Prose.\n" + long).next!.length).toBeLessThanOrEqual(160);
  });
});
