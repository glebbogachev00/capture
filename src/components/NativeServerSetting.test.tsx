// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NativeServerSetting } from "./NativeServerSetting";

afterEach(() => {
  cleanup();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

it("stays out of Settings in a browser", () => {
  const { container } = render(<NativeServerSetting />);
  expect(container.innerHTML).toBe("");
});

it("in the iPhone app, offers another server", () => {
  const nativePromise = vi.fn(async () => ({}));
  (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, nativePromise };
  render(<NativeServerSetting />);
  fireEvent.click(screen.getByRole("button", { name: "Use another server" }));
  expect(nativePromise).toHaveBeenCalledWith("CaptureShell", "chooseServer", {});
});
