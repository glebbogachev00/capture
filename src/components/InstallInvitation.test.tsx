/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallInvitation } from "./InstallInvitation";

const VISITED_KEY = "capture:install-visited:v1";
const DISMISSED_KEY = "capture:install-dismissed:v1";

function setIosBrowser(standalone = false) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  });
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: "iPhone",
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    value: 5,
  });
  Object.defineProperty(window.navigator, "standalone", {
    configurable: true,
    value: standalone,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: standalone }),
  });
}

function setDesktopBrowser() {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
  });
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: "MacIntel",
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    value: 0,
  });
  Object.defineProperty(window.navigator, "standalone", {
    configurable: true,
    value: false,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
}

beforeEach(() => {
  localStorage.clear();
  setIosBrowser();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("iOS home-screen invitation", () => {
  it("does not interrupt a first visit before Capture has worked", () => {
    render(<InstallInvitation successfulCapture={false} hasExistingCapture={false} />);
    expect(screen.queryByRole("button", { name: /add capture to home screen/i })).toBeNull();
  });

  it("appears after the first successful capture", () => {
    const view = render(
      <InstallInvitation successfulCapture={false} hasExistingCapture={false} />
    );
    view.rerender(
      <InstallInvitation successfulCapture={true} hasExistingCapture={true} />
    );
    expect(screen.getByRole("button", { name: /add capture to home screen/i })).toBeTruthy();
  });

  it("appears for a returning visitor who already has a capture", () => {
    localStorage.setItem(VISITED_KEY, "1");
    render(<InstallInvitation successfulCapture={false} hasExistingCapture />);
    expect(screen.getByRole("button", { name: /add capture to home screen/i })).toBeTruthy();
  });

  it("stays quiet for seven days after dismissal", () => {
    localStorage.setItem(VISITED_KEY, "1");
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    render(<InstallInvitation successfulCapture={false} hasExistingCapture />);
    expect(screen.queryByRole("button", { name: /add capture to home screen/i })).toBeNull();
  });

  it("never appears when Capture is already installed", () => {
    setIosBrowser(true);
    localStorage.setItem(VISITED_KEY, "1");
    render(<InstallInvitation successfulCapture hasExistingCapture />);
    expect(screen.queryByRole("button", { name: /add capture to home screen/i })).toBeNull();
  });

  it("never appears on desktop", () => {
    setDesktopBrowser();
    localStorage.setItem(VISITED_KEY, "1");
    render(<InstallInvitation successfulCapture hasExistingCapture />);
    expect(screen.queryByRole("button", { name: /add capture to home screen/i })).toBeNull();
  });

  it("shows the visual steps and remembers Not now", () => {
    const view = render(<InstallInvitation successfulCapture hasExistingCapture />);
    fireEvent.click(screen.getByRole("button", { name: /add capture to home screen/i }));

    expect(screen.getByRole("dialog", { name: /keep capture close/i })).toBeTruthy();
    expect(screen.getByText("Open Share")).toBeTruthy();
    expect(screen.getByText("Add to Home Screen", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText("Tap Add")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(localStorage.getItem(DISMISSED_KEY)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /add capture to home screen/i })).toBeNull();
    view.unmount();
  });
});
