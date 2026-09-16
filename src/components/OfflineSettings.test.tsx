// @vitest-environment jsdom
import * as React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
vi.doMock("react", () => React);
afterEach(() => { cleanup(); localStorage.clear(); vi.resetModules(); });
it("offers explicit device consent with shared-device and persistent-permission caveats", async () => {
  vi.stubGlobal("React", React);
  const { installDocumentLifetime, resumeOfflineIdentity } = await import("@/lib/ownership");
  installDocumentLifetime({ owner: "A", expiresAt: Date.now() + 60000 });
  const { OfflineSettings } = await import("./OfflineSettings");
  render(<OfflineSettings />);
  const toggle = screen.getByRole("checkbox", { name: "Keep available offline on this device" });
  expect((toggle as HTMLInputElement).checked).toBe(false);
  expect(screen.getByText(/Shared device/)).toBeTruthy();
  const details = screen.getByText("Offline access details").closest("details")!;
  expect(details.open).toBe(false);
  fireEvent.click(screen.getByText("Offline access details"));
  expect(details.open).toBe(true);
  expect(screen.getByText(/Access lasts until you log out, switch accounts, or disable it in Settings/)).toBeTruthy();
  expect(screen.getByText(/cannot detect remote account revocation while offline/)).toBeTruthy();
  fireEvent.click(toggle);
  expect(resumeOfflineIdentity()?.owner).toBe("A");
  fireEvent.click(toggle);
  expect(resumeOfflineIdentity()).toBeNull();
});
