// @vitest-environment jsdom
import * as React from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
vi.doMock("react", () => React);
vi.stubGlobal("React", React);
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.resetModules(); });

async function setup(owner: string | null | undefined = "A", offline = false) {
  const ownership = await import("@/lib/ownership");
  const lifetime = ownership.installDocumentLifetime(owner === undefined ? undefined : { owner, expiresAt: Date.now() + 60000, offline });
  const components = await import("./OfflineSettings");
  return { ...ownership, ...components, lifetime };
}
it("waits for successful board load and never grants by rendering", async () => {
  const { OfflineInvitation, resumeOfflineIdentity } = await setup();
  const view = render(<OfflineInvitation boardReady={false} />);
  expect(screen.queryByRole("button", { name: "Enable offline" })).toBeNull();
  view.rerender(<OfflineInvitation boardReady />);
  expect(screen.getByRole("heading", { name: "Enable offline on this device?" })).toBeTruthy();
  expect(resumeOfflineIdentity()).toBeNull();
  const confirm = screen.getByRole("button", { name: "Enable offline" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(false);
  expect(screen.queryByRole("checkbox", { name: "Offline on this device" })).toBeNull();
  expect(resumeOfflineIdentity()).toBeNull();
  expect(screen.getByText(/Shared device/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
});
it("accepts explicitly for the verified owner and Settings can disable without a new invitation", async () => {
  const { OfflineInvitation, OfflineSettings, resumeOfflineIdentity } = await setup();
  render(<><OfflineInvitation boardReady /><OfflineSettings /></>);
  fireEvent.click(screen.getByRole("button", { name: "Enable offline" }));
  expect(resumeOfflineIdentity()?.owner).toBe("A");
  expect(screen.queryByRole("button", { name: "Enable offline" })).toBeNull();
  const checkbox = screen.getByRole("checkbox");
  expect((checkbox as HTMLInputElement).checked).toBe(true);
  fireEvent.click(checkbox);
  expect(resumeOfflineIdentity()).toBeNull();
  expect(screen.queryByRole("button", { name: "Enable offline" })).toBeNull();
});
it("Not now survives a document reload for this account, but does not grant or suppress another account", async () => {
  let api = await setup();
  let view = render(<api.OfflineInvitation boardReady />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(api.resumeOfflineIdentity()).toBeNull();
  view.unmount(); vi.resetModules();
  api = await setup("A");
  view = render(<api.OfflineInvitation boardReady />);
  expect(screen.queryByRole("button", { name: "Enable offline" })).toBeNull();
  view.unmount(); vi.resetModules();
  api = await setup("B");
  render(<api.OfflineInvitation boardReady />);
  expect(api.resumeOfflineIdentity()).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Enable offline" }));
  expect(api.resumeOfflineIdentity()?.owner).toBe("B");
});
it("does not ask an already-enabled owner or overwrite their permission", async () => {
  const { OfflineInvitation, lifetime, OFFLINE_PERMISSION_KEY } = await setup();
  lifetime.keepOffline(true);
  const before = localStorage.getItem(OFFLINE_PERMISSION_KEY);
  render(<OfflineInvitation boardReady />);
  expect(screen.queryByRole("button", { name: "Enable offline" })).toBeNull();
  expect(localStorage.getItem(OFFLINE_PERMISSION_KEY)).toBe(before);
});
it.each(["anonymous", "local", "offline", "expired", "revoked"])("skips %s documents", async mode => {
  const ownership = await import("@/lib/ownership");
  const lifetime = ownership.installDocumentLifetime(mode === "local" ? undefined : {
    owner: mode === "anonymous" ? null : "A", expiresAt: Date.now() + (mode === "expired" ? -1 : 60000), offline: mode === "offline",
  });
  if (mode === "revoked") lifetime.revoke();
  const { OfflineInvitation } = await import("./OfflineSettings");
  render(<OfflineInvitation boardReady />);
  expect(screen.queryByRole("button", { name: "Enable offline" })).toBeNull();
});
it("a revoked account cannot accept an invitation left on screen", async () => {
  const { OfflineInvitation, lifetime, resumeOfflineIdentity } = await setup();
  render(<OfflineInvitation boardReady />);
  const button = screen.getByRole("button", { name: "Enable offline" });
  act(() => lifetime.revoke());
  fireEvent.click(button);
  expect(resumeOfflineIdentity()).toBeNull();
});
it("expired or disconnected acceptance fails without recording consent", async () => {
  const { OfflineInvitation, lifetime, resumeOfflineIdentity } = await setup();
  render(<OfflineInvitation boardReady />);
  lifetime.expiresAt = Date.now() - 1;
  fireEvent.click(screen.getByRole("button", { name: "Enable offline" }));
  expect(resumeOfflineIdentity()).toBeNull();
});
it("decline remains usable when browser storage is blocked", async () => {
  const { OfflineInvitation, resumeOfflineIdentity } = await setup();
  render(<OfflineInvitation boardReady />);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(screen.queryByRole("button", { name: "Enable offline" })).toBeNull();
  expect(resumeOfflineIdentity()).toBeNull();
});
it("Escape dismisses without consent and does not nag on remount", async () => {
  const { OfflineInvitation, resumeOfflineIdentity } = await setup();
  const view = render(<OfflineInvitation boardReady />);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
  expect(resumeOfflineIdentity()).toBeNull();
  view.unmount();
  render(<OfflineInvitation boardReady />);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("disconnected acceptance cannot grant offline permission", async () => {
  const { OfflineInvitation, resumeOfflineIdentity } = await setup();
  render(<OfflineInvitation boardReady />);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Enable offline" }));
  expect(resumeOfflineIdentity()).toBeNull();
});
it("blocked permission storage reports failure and leaves retry and decline available", async () => {
  const { OfflineInvitation, resumeOfflineIdentity } = await setup();
  render(<OfflineInvitation boardReady />);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  fireEvent.click(screen.getByRole("button", { name: "Enable offline" }));
  expect(resumeOfflineIdentity()).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("Could not save offline permission");
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("Capture wires the invitation to loaded, uncorrupted and successfully synced board state", () => {
  const source = readFileSync("src/app/Capture.tsx", "utf8");
  expect(source).toContain('<OfflineInvitation boardReady={loaded && !corrupt && sync?.ok === true}');
  expect(readFileSync("src/app/Intentions.tsx", "utf8")).toContain("<OfflineSettings />");
});
