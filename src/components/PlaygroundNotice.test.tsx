/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaygroundNotice } from "./PlaygroundNotice";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CLOUD_URL", "https://cloud.trycapture.app");
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe("PlaygroundNotice trial boundary", () => {
  it("keeps both clear paths out of the browser-only playground visible", () => {
    render(<PlaygroundNotice />);
    expect(screen.getByText("Choose where to keep your board")).toBeTruthy();
    expect(screen.getByText(/This playground stays in this browser/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Use Capture Cloud" }).getAttribute("href"))
      .toBe("https://cloud.trycapture.app/login?next=%2Fapp");
    expect(screen.getByRole("link", { name: "Install Capture" }).getAttribute("href"))
      .toBe("/install");
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("keeps the self-hosted path when Cloud is not configured", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUD_URL", "");
    render(<PlaygroundNotice />);
    expect(screen.queryByRole("link", { name: "Use Capture Cloud" })).toBeNull();
    expect(screen.getByRole("link", { name: "Install Capture" })).toBeTruthy();
  });
});
