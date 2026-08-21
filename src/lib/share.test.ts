import { describe, expect, it } from "vitest";
import type { Action } from "./model";
import { shareAction } from "./share";
describe("shareAction — one task, on its way to an assistant", () => {
  const act = (over: Partial<Action> = {}): Action => ({
    id: "a1",
    text: "Fix heat map bug",
    done: false,
    at: 1000,
    shelf: "keep",
    expires: null,
    ...over,
  });

  it("carries the original when it says more than the card", () => {
    /* "Fix heat map bug" tells a model nothing; the sentence it came from
       says what is actually wrong. */
    const out = shareAction(
      act({ src: "Heat map seems off: some months are too close together." })
    );
    expect(out.text).toContain("Fix heat map bug");
    expect(out.text).toContain("Context:");
    expect(out.text).toContain("some months are too close together");
  });

  it("does not paste the same sentence twice over a full stop", () => {
    /* The sorter routinely hands back the capture with punctuation added. */
    const out = shareAction(
      act({ text: "Buy running clothes", src: "Buy running clothes." })
    );
    expect(out.text).toBe("Buy running clothes");
    expect(out.text).not.toContain("Context:");
  });

  it("includes a deadline, since it is the first thing anyone asks", () => {
    const out = shareAction(act({ due: Date.UTC(2026, 7, 22) }));
    expect(out.text).toContain("Due:");
  });

  it("stays plain text — this gets pasted into a chat box", () => {
    const out = shareAction(act({ src: "something longer entirely" }));
    expect(out.text.startsWith("#")).toBe(false);
  });
});
