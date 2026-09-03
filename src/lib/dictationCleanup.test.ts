import { describe, expect, it } from "vitest";
import { CLEANUP_SYSTEM } from "./dictationCleanup";

describe("dictation cleanup trust contract", () => {
  it("preserves unfamiliar names and unclear tokens verbatim instead of guessing", () => {
    expect(CLEANUP_SYSTEM).toContain(
      "Do not correct, replace, spell-check, infer, or normalize unfamiliar words, names, brands, product terms, abbreviations, or proper nouns."
    );
    expect(CLEANUP_SYSTEM).toContain(
      "If a token could be a name, brand, product term, abbreviation, or proper noun, preserve its raw spelling verbatim."
    );
    expect(CLEANUP_SYSTEM).toContain(
      "Never guess what an unclear token was meant to be."
    );
  });

  it("keeps cleanup bounded to speech artifacts rather than grammar rewriting", () => {
    expect(CLEANUP_SYSTEM).toContain("Remove filler words");
    expect(CLEANUP_SYSTEM).not.toContain("obvious grammar slips");
    expect(CLEANUP_SYSTEM).toMatch(/never summarise, interpret, reorder, or add anything/i);
  });
});
