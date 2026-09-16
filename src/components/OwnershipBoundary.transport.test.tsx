// @vitest-environment jsdom
import "fake-indexeddb/auto";
import * as React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.doMock("react", () => React);
beforeEach(() => { localStorage.clear(); vi.resetModules(); vi.stubGlobal("React", React); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each(["stale-online", "offline", "hung-fetch", "hung-body"])("real cold boundary opens only the saved consented namespace for %s", async mode => {
  const ownership = await import("@/lib/ownership");
  const { createStorage } = await import("@/lib/storage");
  const initial = new ownership.OwnershipLifetime({ owner: "transport-A", expiresAt: Date.now() + 60000 });
  initial.keepOffline(true);
  await createStorage(initial).set("transport-fixture", "A SYNTHETIC PRIVATE");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(mode !== "offline");
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (mode === "hung-fetch") return new Promise(() => {});
    if (mode === "hung-body") { const response = Response.json({}); response.json = () => new Promise(() => {}); return response; }
    throw new TypeError("Failed to fetch");
  }));
  const { OwnershipBoundary } = await import("./OwnershipBoundary");
  let life: InstanceType<typeof ownership.OwnershipLifetime>;
  function LocalProbe() {
    life = ownership.getDocumentLifetime();
    const [saved, setSaved] = React.useState("");
    React.useEffect(() => { void createStorage(life).get("transport-fixture").then(value => setSaved(value ?? "")); }, []);
    return <p>{saved}</p>;
  }
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  render(<OwnershipBoundary cloud><LocalProbe /></OwnershipBoundary>);
  expect(screen.queryByText("A SYNTHETIC PRIVATE")).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(4500); });
  vi.useRealTimers();
  expect(await screen.findByText("A SYNTHETIC PRIVATE")).toBeTruthy();
  expect(screen.getByText(/Offline on this device/)).toBeTruthy();
  expect(life!.database).toBe("capture-cloud-v1-account-transport-A");
  expect(() => life!.assertOnline()).toThrow();
  expect(ownership.resumeOfflineIdentity()?.owner).toBe("transport-A");
});
