/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchResults } from "./SearchResults";
import type { Hits } from "@/lib/search";

afterEach(cleanup);

function hits(overrides: Partial<Hits> = {}): Hits {
  return {
    actions: [],
    unsorted: [],
    threads: [],
    intentions: [],
    total: 0,
    ...overrides,
  };
}

describe("SearchResults", () => {
  it("does not claim there are no results while a question answer is loading", () => {
    const { container } = render(
      <SearchResults
        hits={hits()}
        now={2}
        awaitingAnswer
        onOpenThread={vi.fn()}
        onOpenIntention={vi.fn()}
      />,
    );

    expect(container.textContent).toBe("");
    expect(screen.queryByText("Nothing by that shape.")).toBeNull();
  });

  it("does not duplicate waiting captures from the strip into Search results", () => {
    render(
      <SearchResults
        hits={hits({
          unsorted: [
            {
              id: "waiting",
              text: "Offline launch notes",
              done: false,
              at: 1,
              shelf: "keep",
              expires: null,
              unsorted: true,
            },
          ],
          total: 1,
        })}
        now={2}
        onOpenThread={vi.fn()}
        onOpenIntention={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Unsorted/)).toBeNull();
    expect(screen.queryByText("Offline launch notes")).toBeNull();
    expect(screen.queryByText(/Actions ·/)).toBeNull();
    expect(screen.queryByText("kept")).toBeNull();
  });
});
