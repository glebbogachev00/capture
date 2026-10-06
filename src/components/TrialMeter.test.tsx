/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrialMeter } from "./TrialMeter";
import type { TrialState } from "@/lib/playground";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

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
    expect(screen.queryByRole("link", { name: "See Capture Cloud" })).toBeNull();
  });

  it("gives a signed-in free Cloud board a direct path to pricing", () => {
    render(<TrialMeter trial={trial(15)} showCloudUpgrade />);
    expect(screen.getByRole("link", { name: "See Capture Cloud" }).getAttribute("href"))
      .toBe("/pricing");
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

  it("keeps the Cloud pricing path visible when the signed-in trial is exhausted", () => {
    render(<TrialMeter trial={trial(0)} showCloudUpgrade />);
    expect(screen.getByRole("link", { name: "See Capture Cloud" }).getAttribute("href"))
      .toBe("/pricing");
  });

  it("in the iPhone app, offers Cloud when the day's captures run out", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUD_URL", "https://cloud.trycapture.app");
    (window as unknown as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      nativePromise: async () => ({}),
    };
    const { rerender } = render(<TrialMeter trial={trial(3)} />);
    expect(screen.queryByRole("link", { name: "Get Capture Cloud" })).toBeNull();
    rerender(<TrialMeter trial={trial(0)} />);
    expect(screen.getByRole("link", { name: "Get Capture Cloud" }).getAttribute("href"))
      .toBe("https://cloud.trycapture.app/pricing#plans");
    expect(screen.queryByRole("link", { name: "Install your own" })).toBeNull();
  });
});
