import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A failed sort must never change the shape of the board — and now the
 * rules themselves live in lib/settle, where settle.test.ts checks them as
 * BEHAVIOR: no invented threads, board and history entry describing the
 * same event, the visible tab structurally unable to participate.
 *
 * What remains here is the seam guard: the hook must go through the
 * settlement, not re-grow an inline copy. The old version of this file
 * grepped the hook's source for the rules — and missed the ledger half of
 * the tab bug entirely, which is the argument against source-shape tests
 * made flesh. (Found by the architecture radar, not by this file.)
 */

const source = fs.readFileSync(
  path.join(process.cwd(), "src/hooks/useBoard.ts"),
  "utf8"
);

describe("when the sorter does not answer", () => {
  it("the fallback goes through the settlement", () => {
    const block = source.slice(
      source.indexOf("const saveUnsorted"),
      source.indexOf("captureSnapshot.current", source.indexOf("const saveUnsorted"))
    );
    expect(block).toMatch(/settleUnsortedCapture\(/);
    /* No inline board construction may return. */
    expect(block).not.toMatch(/actions: \[action/);
    expect(block).not.toMatch(/tab ===/);
  });
});
