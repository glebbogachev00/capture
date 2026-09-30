/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsScreen } from "@/app/Intentions";
import type { Principle } from "@/lib/model";

const principle: Principle = {
  id: "p1",
  name: "Keep it concrete",
  description: "Use specific language.",
  enabled: true,
  builtin: true,
};

afterEach(cleanup);

function renderSettings(
  ioBusy: string | null = null,
  sync: { ok: boolean; at: number; note?: string; imageSync?: "failed" } = {
    ok: true,
    at: 1_788_288_000_000,
  },
) {
  const onToggle = vi.fn();
  const onProfileChange = vi.fn();
  render(
    <SettingsScreen
      principles={[principle]}
      counts={{ actions: 2, threads: 3, intentions: 1 }}
      onBack={() => {}}
      onToggle={onToggle}
      onAdd={() => {}}
      onDelete={() => {}}
      onExport={() => {}}
      onRestore={() => {}}
      snapshotDaysList={["2026-09-01"]}
      onRestoreSnapshot={() => {}}
      onCopyBoard={() => {}}
      onImportIntent={() => {}}
      onLogout={() => {}}
      ioNote={null}
      ioBusy={ioBusy}
      sync={sync}
      onSyncNow={() => {}}
      onOpenRecord={() => {}}
      ledgerCount={12}
      profile={undefined}
      onProfileChange={onProfileChange}
    />
  );
  return { onToggle, onProfileChange };
}

describe("SettingsScreen disclosures", () => {
  it("enables the showcase without selecting any intentions and keeps pins when disabled", () => {
    const { onProfileChange } = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Show Personalize" }));
    const toggle = screen.getByRole("switch", { name: "Show intention showcase" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    const update = onProfileChange.mock.calls[0][0];
    expect(update({ name: "Gleb", showSignature: true }))
      .toEqual({ name: "Gleb", showSignature: true, intentionShowcaseEnabled: true });
    expect(update({ name: "Gleb", intentionShowcaseEnabled: true, pinnedIntentionIds: ["rest"] }))
      .toEqual({ name: "Gleb", intentionShowcaseEnabled: false, pinnedIntentionIds: ["rest"] });
  });
  it("groups related controls into a short, plain-language list", () => {
    renderSettings();

    expect(screen.getByRole("button", { name: "Open The Record" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show Capture Cloud" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show Your data" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show Personalize" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show Help and account" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show Data and sync" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show Restore" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show Agent handoff" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show Signature" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show Principles" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download backup" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show Your data" }));
    expect(screen.getByRole("button", { name: "Download backup" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload a Capture backup" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy the whole board" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show Personalize" }));
    expect(screen.queryByRole("button", { name: "Download backup" })).toBeNull();
    expect(screen.getByRole("switch", { name: "Show signature on intentions and threads" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: principle.name })).toBeTruthy();
  });

  it("shows backup progress and prevents a second download while work is in flight", () => {
    renderSettings("Fetching 2 of 6 pictures…");
    fireEvent.click(screen.getByRole("button", { name: "Show Your data" }));

    const blockedTransfers = screen.getAllByRole("button", { name: "Fetching 2 of 6 pictures…" });
    expect(blockedTransfers).toHaveLength(2);
    expect(blockedTransfers.every((button) => button.hasAttribute("disabled"))).toBe(true);
  });

  it("shows incomplete image sync truthfully instead of calling the device offline or synced", () => {
    renderSettings(null, {
      ok: false,
      at: 1_788_288_000_000,
      imageSync: "failed",
      note: "An image is too large to sync — kept locally",
    });

    expect(screen.getByText("images pending")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show Your data" }));
    expect(screen.getByText("An image is too large to sync — kept locally.")).toBeTruthy();
    expect(screen.queryByText("offline")).toBeNull();
  });

  it("offers the approved support contact without removing bug reporting or logout", () => {
    renderSettings();
    expect(screen.queryByRole("link", { name: "Contact support" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show Help and account" }));

    expect(screen.getByRole("link", { name: "Contact support" }).getAttribute("href"))
      .toBe("mailto:gleb@trycapture.app");
    expect(screen.getByText("For account or billing questions, or general help.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Report a bug" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
  });

  it("uses a reversible switch for each principle", () => {
    const { onToggle } = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Show Personalize" }));

    const toggle = screen.getByRole("switch", { name: principle.name });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(principle.id);
  });

  it("keeps card signatures off by default and changes them from Settings", () => {
    const { onProfileChange } = renderSettings();
    const description =
      "Shows your profile photo or initials and name at the bottom of Intention and Thread cards.";
    expect(screen.queryByText(description)).toBeNull();
    expect(
      screen.queryByRole("switch", {
        name: "Show signature on intentions and threads",
      })
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show Personalize" }));
    expect(screen.getByText(description)).toBeTruthy();
    const toggle = screen.getByRole("switch", {
      name: "Show signature on intentions and threads",
    });

    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    const update = onProfileChange.mock.calls[0][0];
    expect(update({ name: "Gleb", showSignature: false })).toEqual({
      name: "Gleb",
      showSignature: true,
    });
  });
});
