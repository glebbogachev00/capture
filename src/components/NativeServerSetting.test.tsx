// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NativeCloudSetting, NativeServerSetting } from "./NativeServerSetting";

vi.mock("@/lib/playground", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/playground")>()),
  PLAYGROUND: true,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
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

it("in the iPhone app's free version, Settings offers Cloud", () => {
  vi.stubEnv("NEXT_PUBLIC_CLOUD_URL", "https://cloud.trycapture.app");
  (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, nativePromise: async () => ({}) };
  render(<NativeCloudSetting />);
  expect(screen.getByRole("button", { name: "Get Capture Cloud" })).toBeTruthy();
});

it("a browser's Settings doesn't get the iPhone app's Cloud entry", () => {
  vi.stubEnv("NEXT_PUBLIC_CLOUD_URL", "https://cloud.trycapture.app");
  const { container } = render(<NativeCloudSetting />);
  expect(container.innerHTML).toBe("");
});
