/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TidyWaiting } from "@/app/TidyWaiting";

describe("TidyWaiting", () => {
  it("describes the board review instead of explaining an old failure", () => {
    render(<TidyWaiting />);

    expect(
      screen.getByText(
        "Tidy is checking the board for duplicate notes, misplaced notes, and notes that may be tasks."
      )
    ).toBeTruthy();
    expect(screen.queryByText("It used to answer in seconds and get it wrong.")).toBeNull();
  });
});