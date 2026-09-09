/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TrialMeter } from "./TrialMeter";
import type { TrialState } from "@/lib/playground";

afterEach(cleanup);

const trial = (remaining: number): TrialState => ({
  remaining,
  exhausted: remaining === 0,
  hint: "",
});

describe("daily trial meter", () => {
  it("shows fourteen used segments and one capture left inside the capture surface", () => {
    const { container } = render(<TrialMeter trial={trial(1)} />);
    expect(screen.getByText("Daily trial")).toBeTruthy();
    expect(screen.getByText("14 / 15 used")).toBeTruthy();
    expect(screen.getByText("1 capture left")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("14");
    expect(container.querySelectorAll(".trial-meter-step")).toHaveLength(15);
    expect(container.querySelectorAll(".trial-meter-step.is-used")).toHaveLength(14);
  });

  it("shows the reset and self-install path after the fifteenth capture", () => {
    const { container } = render(<TrialMeter trial={trial(0)} />);
    expect(screen.getByText("Daily limit reached")).toBeTruthy();
    expect(screen.getByText("15 / 15 used")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("15");
    expect(container.querySelectorAll(".trial-meter-step.is-used")).toHaveLength(15);
    expect(screen.getByText(/resets tomorrow/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /install your own/i }).getAttribute("href"))
      .toBe("/install");
  });
});
