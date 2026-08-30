import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The ratchet: the two modules that hold this app's complexity may only
 * shrink.
 *
 * Between two audits, useBoard.ts grew from 2,744 lines to 4,720 and
 * nothing said so — every fix landed in the same file because that is
 * where everything already was, and the architecture score fell while the
 * test score rose. Growth was invisible because no gate measured it.
 *
 * These ceilings are the measured size at the moment the extraction
 * program started, minus what has been carved out since. When an
 * extraction lands, LOWER the ceiling to the new size — that is the
 * ratchet clicking. Raising a ceiling is a decision to be argued in a
 * commit message, not a side effect of a feature.
 */

const lines = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), p), "utf8").split("\n").length;

describe("the two big files only shrink", () => {
  it("useBoard.ts stays under its ratchet", () => {
    expect(lines("src/hooks/useBoard.ts")).toBeLessThanOrEqual(4544);
  });

  it("Capture.tsx stays under its ratchet", () => {
    expect(lines("src/app/Capture.tsx")).toBeLessThanOrEqual(1975);
  });

  it("policy stays out of the hook: no merge math creeps back", () => {
    /* The three extracted seams, guarded at the import level: the hook may
       CALL the policy modules, and must not re-grow local copies of what
       they own. */
    const hook = fs.readFileSync(
      path.join(process.cwd(), "src/hooks/useBoard.ts"),
      "utf8"
    );
    expect(hook).toMatch(/from "@\/lib\/adopt"/);
    expect(hook).toMatch(/from "@\/lib\/tangleOps"/);
    expect(hook).toMatch(/from "@\/lib\/undoOps"/);
    expect(hook).toMatch(/from "@\/lib\/intentionOps"/);
  });
});
