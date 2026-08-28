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
    expect(splitNext("Still thinking.")).toEqual({
      summary: "Still thinking.",
      next: null,
      belongs: null,
    });
  });

  it("tolerates markdown and quotes around the line", () => {
    expect(splitNext('Prose.\n**NEXT:** "Book the call"').next).toBe("Book the call");
  });

  it("keeps a step to one line", () => {
    const long = "NEXT: " + "do the thing ".repeat(30);
    expect(splitNext("Prose.\n" + long).next!.length).toBeLessThanOrEqual(160);
  });
});

describe("the sorter's boundary line", () => {
  /* BELONGS says what kind of capture goes in this thread and what does not.
     It is read only by the sorter, never shown, so it has to come out of the
     prose entirely — a "Where this stands" block that ends with filing
     instructions would read as nonsense. */
  const body =
    "Capture is an open-source thinking tool.\n" +
    "BELONGS: anything broken or asked for in Capture — not its pricing, which goes to Capture X posts.\n" +
    "NEXT: ship the wrap";

  it("pulls the line out and keeps it", () => {
    const out = splitNext(body);
    expect(out.belongs).toBe(
      "anything broken or asked for in Capture — not its pricing, which goes to Capture X posts."
    );
  });

  it("keeps it out of what the person reads", () => {
    const out = splitNext(body);
    expect(out.summary).toBe("Capture is an open-source thinking tool.");
    expect(out.summary).not.toMatch(/BELONGS/i);
  });

  it("still finds the next step underneath it", () => {
    expect(splitNext(body).next).toBe("ship the wrap");
  });

  it("copes when the model puts them the other way round", () => {
    const out = splitNext(
      "Prose here.\nNEXT: do the thing\nBELONGS: bugs and requests only"
    );
    expect(out.belongs).toBe("bugs and requests only");
    expect(out.next).toBe("do the thing");
    expect(out.summary).toBe("Prose here.");
  });

  it("is simply absent on a board that never had one", () => {
    const out = splitNext("Prose here.\nNEXT: do the thing");
    expect(out.belongs).toBeNull();
    expect(out.summary).toBe("Prose here.");
  });

  it("treats 'none' as no boundary rather than a boundary saying none", () => {
    expect(splitNext("Prose.\nBELONGS: none\nNEXT: none").belongs).toBeNull();
  });
});
