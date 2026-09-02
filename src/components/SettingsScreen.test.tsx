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

function renderSettings() {
  const onToggle = vi.fn();
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
      sync={{ ok: true, at: 1_788_288_000_000 }}
      onSyncNow={() => {}}
      onOpenRecord={() => {}}
      ledgerCount={12}
    />
  );
  return { onToggle };
}

describe("SettingsScreen disclosures", () => {
  it("starts as a compact list and opens only one section at a time", () => {
    renderSettings();

    expect(screen.getByRole("button", { name: "Open The Record" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show Data and sync" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show Restore" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show Agent handoff" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show Principles" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show Support and session" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download backup" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show Data and sync" }));
    expect(screen.getByRole("button", { name: "Download backup" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show Restore" }));
    expect(screen.queryByRole("button", { name: "Download backup" })).toBeNull();
    expect(screen.getByRole("button", { name: "Upload a Capture backup" })).toBeTruthy();
  });

  it("uses a reversible switch for each principle", () => {
    const { onToggle } = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Show Principles" }));

    const toggle = screen.getByRole("switch", { name: principle.name });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(principle.id);
  });
});
