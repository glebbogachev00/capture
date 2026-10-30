/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RecordScreen } from "@/app/Intentions";
import type { CaptureEntry } from "@/lib/ledger";
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

afterEach(cleanup);

describe("RecordScreen disclosures", () => {
  it("shows the selected day's newest capture first without changing the ledger", () => {
    const ledger = [
      { ...entry, id: "middle", at: now, raw: "Middle", clean: "Middle" },
      { ...entry, id: "oldest", at: now - 1000, raw: "Oldest", clean: "Oldest" },
      { ...entry, id: "newest", at: now + 1000, raw: "Newest", clean: "Newest" },
    ];
    const original = JSON.stringify(ledger);
    const { container } = render(<RecordScreen ledger={ledger} now={now} day="2026-09-02"
      onDayChange={() => {}} onBack={() => {}}
      threads={[]} onOpenThread={() => {}} onRestore={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Show today's history" }));
    expect([...container.querySelectorAll(".record-filed")].map(node => node.textContent))
      .toEqual(["Newest", "Middle", "Oldest"]);
    expect(JSON.stringify(ledger)).toBe(original);
  });
  it("keeps the word total without rendering a word-count comparison", () => {
    const longLedger = Array.from({ length: 120 }, (_, index) => ({
      ...entry,
      id: `l${index}`,
      raw: "word",
      clean: "word",
    }));
    render(
      <RecordScreen
        ledger={longLedger}
        now={now}
        day="2026-09-02"
        onDayChange={() => {}}
        onBack={() => {}}
        threads={[thread]}
        onOpenThread={() => {}}
        onRestore={() => {}}
      />
    );

    expect(screen.getByText(/about 120 words caught/)).toBeTruthy();
    expect(screen.queryByText(/a long text message/)).toBeNull();
  });

  it("keeps history quiet until opened, with no sorting-preference switches", () => {
    render(
      <RecordScreen
        ledger={[entry]}
        now={now}
        day="2026-09-02"
        onDayChange={() => {}}
        onBack={() => {}}
        threads={[thread]}
        onOpenThread={() => {}}
        onRestore={() => {}}
      />
    );

    expect(screen.queryByText("Clean up the record")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show today's history" }));
    expect(screen.getByText("Clean up the record")).toBeTruthy();
    /* The examples behind those switches no longer reach the sorter (30 Oct 2026). */
    expect(screen.queryByRole("button", { name: "Show sorting preferences" })).toBeNull();
  });
});
