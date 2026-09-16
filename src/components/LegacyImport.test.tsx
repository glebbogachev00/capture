// @vitest-environment jsdom
import "fake-indexeddb/auto";
import * as React from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { OwnershipLifetime } from "@/lib/ownership";
import { createStorage } from "@/lib/storage";
import { EMPTY, KEY } from "@/lib/model";
import * as ownership from "@/lib/ownership";
import * as backup from "@/lib/backup";
import { LegacyImportGate, LegacyImportSettings } from "./LegacyImport";
import { importLegacyBoard } from "@/lib/legacyImport";
vi.stubGlobal("React", React);
const life = () => new OwnershipLifetime({ owner: "destination-account", expiresAt: Date.now() + 60000 });
beforeEach(async () => {
  for (const store of [createStorage(life()), createStorage(new OwnershipLifetime())]) for (const key of await store.keys()) await store.del(key);
  await createStorage(new OwnershipLifetime()).set(KEY, JSON.stringify({ ...EMPTY, actions: [{ id: "secret", text: "DO NOT PREVIEW", at: 1 }] }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("Settings retains the import entry after deferral and exposes a downloadable original snapshot after import", async () => {
  const owner = life();
  vi.spyOn(ownership, "getDocumentLifetime").mockReturnValue(owner);
  const download = vi.spyOn(backup, "downloadJSON").mockImplementation(() => {});
  const view = render(<LegacyImportSettings />);
  expect(await screen.findByRole("link", { name: "Import earlier local board" })).toBeTruthy();
  view.unmount();
  await importLegacyBoard(owner, true);
  render(<LegacyImportSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "Download original snapshot" }));
  await waitFor(() => expect(download).toHaveBeenCalledOnce());
  expect(JSON.stringify(download.mock.calls[0][0])).toContain("DO NOT PREVIEW");
  expect(screen.getByText(/Device settings and unsupported entries stay archive-only/)).toBeTruthy();
});
it("names destination without previewing contents, requires confirmation and reports local-only completion", async () => {
  const owner = life();
  render(<LegacyImportGate lifetime={owner}><p>ACCOUNT BOARD</p></LegacyImportGate>);
  await screen.findByText("There’s an earlier Capture board on this device");
  expect(screen.getByText(/destination-account/)).toBeTruthy();
  expect(document.body.textContent).not.toContain("DO NOT PREVIEW");
  expect(document.body.textContent).not.toContain("ACCOUNT BOARD");
  const button = screen.getByRole("button", { name: "Import my local board" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: /permission to access/ }));
  fireEvent.click(button);
  await screen.findByText("Imported on this device");
  expect(document.body.textContent).not.toContain("backed up");
  fireEvent.click(screen.getByRole("button", { name: "Open my board" }));
  await screen.findByText("ACCOUNT BOARD");
});
it.each([1, 3])("uses correct missing-photo grammar for %i photos in completion and Settings", async (count) => {
  await createStorage(new OwnershipLifetime()).set(KEY, JSON.stringify({ ...EMPTY,
    threads: [{ id: "photos", name: "Earlier photos", summary: "", frags: [{ id: "frag", text: "Photo note", at: 1, imgs: Array.from({ length: count }, (_, i) => `missing-${i}`) }] }],
  }));
  const owner = life();
  vi.spyOn(ownership, "getDocumentLifetime").mockReturnValue(owner);
  const view = render(<LegacyImportGate lifetime={owner}><p>ACCOUNT BOARD</p></LegacyImportGate>);
  fireEvent.click(await screen.findByRole("checkbox", { name: /permission to access/ }));
  fireEvent.click(screen.getByRole("button", { name: "Import my local board" }));
  const warning = count === 1 ? "1 referenced photo was missing" : "3 referenced photos were missing";
  const reference = count === 1 ? "Its reference remains" : "Their references remain";
  expect((await screen.findByRole("alert")).textContent).toBe(`${warning} on this device. ${reference} in the snapshot.`);
  view.unmount();
  render(<LegacyImportSettings />);
  await waitFor(() => expect(screen.getByText(/Imported on this device\./).textContent).toContain(`${warning}.`));
});
it("Not now preserves originals and does not ask again on a normal reopen", async () => {
  const before = await createStorage(new OwnershipLifetime()).get(KEY);
  const view = render(<LegacyImportGate lifetime={life()}><p>ACCOUNT BOARD</p></LegacyImportGate>);
  await screen.findByText("There’s an earlier Capture board on this device");
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await screen.findByText("ACCOUNT BOARD");
  view.unmount();
  render(<LegacyImportGate lifetime={life()}><p>ACCOUNT BOARD</p></LegacyImportGate>);
  await waitFor(() => expect(screen.getByText("ACCOUNT BOARD")).toBeTruthy());
  expect(screen.queryByText("There’s an earlier Capture board on this device")).toBeNull();
  expect(await createStorage(new OwnershipLifetime()).get(KEY)).toBe(before);
  expect(await createStorage(life()).get(KEY)).toBeNull();
});
