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
 *
 * Raised once, deliberately: 4,290 → 4,363, for Undo on Organize.
 * Approving a tidy proposal used to be the only irreversible gesture in
 * the app — one tap of Approve-all could drop actions, destroy their
 * photos' bytes, and push the deletions to every other device with no way
 * back. Closing that needed a deferred-delete queue, a second receipt
 * window, and one snapshot per gesture rather than per row. Two modules
 * were carved out to pay for it (lib/heldImages, lib/organizeOps, ~105
 * lines with their own tests); the 73 that remain are the feature itself, including a generation guard
 * that stops any of the twenty-two loose notice timers blanking a notice
 * that is still carrying an Undo.
 * The argument was: a safety net on the app's most destructive path is
 * worth more than 56 lines of the extraction budget.
 */

const lines = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), p), "utf8").split("\n").length;

describe("the two big files only shrink", () => {
  it("useBoard.ts stays under its ratchet", () => {
    expect(lines("src/hooks/useBoard.ts")).toBeLessThanOrEqual(4363);
  });

  it("Capture.tsx stays under its ratchet", () => {
    expect(lines("src/app/Capture.tsx")).toBeLessThanOrEqual(1251);
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
    expect(hook).toMatch(/from "@\/lib\/tangleGate"/);
    expect(hook).toMatch(/from "@\/lib\/receiptWindow"/);
    expect(hook).toMatch(/from "@\/lib\/fragOps"/);
    expect(hook).toMatch(/from "@\/lib\/actionOps"/);
    expect(hook).toMatch(/from "@\/lib\/suggestionRecord"/);
  });
});
