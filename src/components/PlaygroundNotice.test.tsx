/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaygroundNotice } from "./PlaygroundNotice";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CLOUD_URL", "https://cloud.trycapture.app");
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe("PlaygroundNotice trial boundary", () => {
  it("presents one primary Cloud action with a quieter login path", () => {
    render(<PlaygroundNotice />);
    expect(screen.getByText("Choose where to keep your board")).toBeTruthy();
    expect(screen.getByText(
      "This playground stays in this browser. Use Cloud to sync across devices.",
    )).toBeTruthy();
    expect(screen.queryByText(/install Capture/i)).toBeNull();

    const cloudLink = screen.getByRole("link", { name: "Start with Capture Cloud" });
    const loginLink = screen.getByRole("link", { name: "Try Capture Locally" });
    const actions = cloudLink.parentElement;
    expect(cloudLink.getAttribute("href")).toBe("https://cloud.trycapture.app/pricing#plans");
    expect(loginLink.getAttribute("href")).toBe("https://cloud.trycapture.app/app");
    expect(actions?.querySelectorAll("a")).toHaveLength(2);
    expect(cloudLink.classList.contains("playground-note-action")).toBe(true);
    expect(loginLink.classList.contains("playground-note-action")).toBe(true);
    expect(cloudLink.classList.contains("is-primary")).toBe(true);
    expect(loginLink.classList.contains("is-secondary")).toBe(true);
    expect(loginLink.parentElement).toBe(actions);
    expect(screen.queryByRole("link", { name: "Install Capture" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("shows no unavailable actions when Cloud is not configured", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUD_URL", "");
    render(<PlaygroundNotice />);
    expect(screen.queryByRole("link", { name: "Use Capture Cloud" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Log in to Capture Cloud" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Install Capture" })).toBeNull();
  });
});
