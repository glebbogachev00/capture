// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptureReceipt } from "@/components/CaptureReceipt";
import { createReceiptWindow, RECEIPT_MS } from "@/lib/receiptWindow";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CaptureReceipt", () => {
  it.each([false, true])("hides the receipt and its Undo when its window ends (manual=%s)", (canUndoManual) => {
    vi.useFakeTimers();
    const onUndo = vi.fn(), onUndoManual = vi.fn();
    const props = { canUndo: true, canUndoManual, onUndo, onUndoManual };
    const view = render(<CaptureReceipt {...props} receipt="Actions" />);
    const window = createReceiptWindow(() => {
      // Match useBoard's expiry: receipt clears, Undo availability does not.
      view.rerender(<CaptureReceipt {...props} receipt={null} lines={[]} />);
    });
    window.open();

    act(() => vi.advanceTimersByTime(RECEIPT_MS - 1));
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).toBeNull();
    expect(view.container.querySelector(".landed, .capture-receipt")).toBeNull();
    expect(view.container.textContent).toBe("");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(onUndo).not.toHaveBeenCalled();
    expect(onUndoManual).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.queryByRole("status")).toBeNull();
    expect(view.container.textContent).toBe("");
    view.rerender(<CaptureReceipt {...props} canUndo={false} canUndoManual={false} receipt={null} />);
    expect(view.container.textContent).toBe("");
  });

  it("keeps pending and manual split acknowledgments distinct from AI sorting", () => {
    const { rerender } = render(<CaptureReceipt receipt="Saved. Awaiting sorting or placement"
      pendingReceipt canUndo={false} onUndo={() => undefined} />);
    expect(screen.getByRole("status").textContent).toBe("Saved. Awaiting sorting or placement");
    expect(screen.queryByText("Capture sorted this into:")).toBeNull();
    rerender(<CaptureReceipt receipt="Split filed" canUndo={false} onUndo={() => undefined} />);
    expect(screen.getByRole("status").textContent).toBe("Split filed");
  });

  it("prioritizes the manual inverse over capture Undo without claiming AI sorted it", () => {
    const onUndo = vi.fn(), onUndoManual = vi.fn();
    render(<CaptureReceipt receipt="Actions" canUndo canUndoManual
      onUndo={onUndo} onUndoManual={onUndoManual} />);
    expect(screen.getByRole("status").textContent).toContain("Landed in Actions.");
    expect(screen.queryByText("Capture sorted this into:")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndoManual).toHaveBeenCalledOnce();
    expect(onUndo).not.toHaveBeenCalled();
  });
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