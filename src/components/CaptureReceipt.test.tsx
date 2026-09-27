// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CaptureReceipt } from "@/components/CaptureReceipt";

describe("CaptureReceipt", () => {
  it("shows each sorted destination as a readable list", () => {
    render(
      <CaptureReceipt
        receipt="1 action · a new thread — Launch notes"
        canUndo={false}
        onUndo={() => undefined}
      />,
    );

    expect(screen.getByText("Capture sorted this into:")).toBeTruthy();
    expect(screen.getByText("1 action")).toBeTruthy();
    expect(screen.getByText("New thread: Launch notes")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("keeps the existing Undo action available", () => {
    const onUndo = vi.fn();
    render(
      <CaptureReceipt
        receipt="Thread · Capture"
        canUndo
        onUndo={onUndo}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
  });
});