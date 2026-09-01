/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecordScreen } from "@/app/Intentions";
import type { CaptureEntry } from "@/lib/ledger";
import type { RulePreference } from "@/lib/rules";
import type { Thread } from "@/lib/model";

const now = new Date(2026, 8, 2, 12).getTime();
const thread: Thread = {
  id: "capture",
  name: "Capture.",
  summary: "A thinking system shaped through use.",
  frags: [{ id: "f1", at: now, text: "Clean up the record" }],
};
const entry: CaptureEntry = {
  id: "l1",
  at: now,
  raw: "Clean up the record",
  clean: "Clean up the record",
  kind: "thread",
  source: "typed",
  targetId: thread.id,
};
const rule: RulePreference = {
  key: "capture bugs belong in bugs",
  text: "Capture bugs belong in Bugs",
  accepts: 2,
  dismisses: 0,
  confidence: 1,
  lastAt: now,
  enabled: true,
};

describe("RecordScreen disclosures", () => {
  it("keeps history and sorting preferences quiet until opened", () => {
    const onToggleRule = vi.fn();
    render(
      <RecordScreen
        ledger={[entry]}
        now={now}
        onBack={() => {}}
        rules={[rule]}
        onToggleRule={onToggleRule}
        threads={[thread]}
        onOpenThread={() => {}}
        onRestore={() => {}}
      />
    );

    expect(screen.queryByText("Clean up the record")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show today's history" }));
    expect(screen.getByText("Clean up the record")).toBeTruthy();

    expect(screen.queryByText(rule.text)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Show sorting preferences" })
    );
    expect(screen.getByText(rule.text)).toBeTruthy();

    const toggle = screen.getByRole("switch", { name: rule.text });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(onToggleRule).toHaveBeenCalledWith(rule.key, false);
  });
});
