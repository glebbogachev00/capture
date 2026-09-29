import { describe, expect, it } from "vitest";
import { DUE_RULE, RELATIVE_DUE_RULE } from "./engineRules";

describe("relative deadline prompt contract", () => {
  it("defines tomorrow and relative weekdays across calendar boundaries without computing them in production", () => {
    expect(RELATIVE_DUE_RULE).toContain(
      '"tomorrow" means the next local calendar day, including across month or year boundaries'
    );
    expect(RELATIVE_DUE_RULE).toContain(
      "the next calendar occurrence of that weekday strictly after today"
    );
    expect(RELATIVE_DUE_RULE).toContain(
      "If today is that weekday, use the date seven days later"
    );
    expect(RELATIVE_DUE_RULE).toContain(
      "verify that the resolved ISO date falls on the named weekday"
    );
    expect(DUE_RULE).toContain(RELATIVE_DUE_RULE);
  });
});
