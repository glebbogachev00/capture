/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaygroundNotice } from "./PlaygroundNotice";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CLOUD_URL", "https://cloud.trycapture.app");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe("PlaygroundNotice trial boundary", () => {
  it("presents one primary Cloud action with a quieter login path", () => {
    render(<PlaygroundNotice />);
    expect(screen.getByText("Choose where to keep your board")).toBeTruthy();
    expect(screen.getByText(
      "This playground stays in this browser. Use Cloud to sync across devices.",
    )).toBeTruthy();
    expect(screen.queryByText(/install Capture/i)).toBeNull();

    const cloudLink = screen.getByRole("link", { name: "Start with Capture Cloud" });
    const localLink = screen.getByRole("link", { name: "Try Capture Locally" });
    const actions = cloudLink.parentElement;
    expect(cloudLink.getAttribute("href")).toBe("https://cloud.trycapture.app/pricing#plans");
    expect(localLink.getAttribute("href")).toBe("/install");
    expect(actions?.querySelectorAll("a")).toHaveLength(2);
    expect(cloudLink.classList.contains("playground-note-action")).toBe(true);
    expect(localLink.classList.contains("playground-note-action")).toBe(true);
    expect(cloudLink.classList.contains("is-primary")).toBe(true);
    expect(localLink.classList.contains("is-secondary")).toBe(true);
    expect(localLink.parentElement).toBe(actions);
    expect(screen.queryByRole("link", { name: "Install Capture" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("keeps the local path when Cloud is not configured", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUD_URL", "");
    render(<PlaygroundNotice />);
    expect(screen.queryByRole("link", { name: "Start with Capture Cloud" })).toBeNull();
    expect(screen.getByRole("link", { name: "Try Capture Locally" }).getAttribute("href"))
      .toBe("/install");
    expect(screen.queryByRole("link", { name: "Install Capture" })).toBeNull();
  });

  it("in the iPhone app, says the board is on the phone and drops the install link", () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      nativePromise: async () => ({}),
    };
    render(<PlaygroundNotice />);
    expect(screen.getByText("Your board stays on this phone. Use Cloud to sync across devices.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start with Capture Cloud" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Try Capture Locally" })).toBeNull();
  });
});
