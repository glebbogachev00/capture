/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Action, Thread } from "@/lib/model";
import { DestinationPicker } from "./DestinationPicker";

const capture: Action = {
  id: "pending-one",
  text: "A long capture that should remain identifiable while choosing its destination",
  done: false,
  at: 1,
  shelf: "keep",
  expires: null,
  unsorted: true,
};
const threads: Thread[] = [
  { id: "recent", name: "Recent work", summary: "", frags: [], updatedAt: 3 },
  { id: "older", name: "Older notes", summary: "", frags: [], updatedAt: 1 },
];

afterEach(cleanup);

describe("DestinationPicker", () => {
  it("makes the background inert until dismissal and does not reset focus when callbacks change", () => {
    const background = document.createElement("main");
    document.body.appendChild(background);
    const { rerender, unmount } = render(<DestinationPicker capture={capture} threads={threads}
      onChoose={vi.fn()} onClose={vi.fn()} />);
    expect(background.hasAttribute("inert")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    const action = screen.getByRole("button", { name: "Action" });
    action.focus();
    rerender(<DestinationPicker capture={capture} threads={threads}
      onChoose={vi.fn()} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(action);
    unmount();
    expect(background.hasAttribute("inert")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    background.remove();
  });
  it("renders one screen-level dialog with the approved hierarchy and immediate destinations", () => {
    const onChoose = vi.fn();
    render(<main><article data-testid="card">Card</article><DestinationPicker
      capture={capture} threads={threads} onChoose={onChoose} onClose={vi.fn()} /> </main>);

    const dialog = screen.getByRole("dialog", { name: "Choose a place" });
    expect(dialog.parentElement?.classList.contains("destination-picker-layer")).toBe(true);
    expect(within(screen.getByTestId("card")).queryByRole("dialog")).toBeNull();
    expect(within(dialog).getByText(/A long capture that should remain identifiable/)).toBeTruthy();
    expect(within(dialog).getByRole("searchbox", { name: "Find a thread" })).toBeTruthy();
    expect(within(dialog).getByText("Quick destinations")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Action" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Intention" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Create new thread" })).toBeTruthy();
    expect(within(dialog).getByText("Recent threads")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Action" }));
    expect(onChoose).toHaveBeenCalledWith({ kind: "action" });
  });

  it("closes on Escape, scrim, and close while returning focus to the trigger", async () => {
    const onClose = vi.fn();
    const trigger = document.createElement("button");
    trigger.textContent = "Choose a place";
    document.body.appendChild(trigger);
    const { rerender } = render(<DestinationPicker capture={capture} threads={threads}
      onChoose={vi.fn()} onClose={onClose} returnFocus={trigger} />);
    const dialog = screen.getByRole("dialog", { name: "Choose a place" });
    expect(document.activeElement).toBe(within(dialog).getByRole("searchbox", { name: "Find a thread" }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<></>);
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    onClose.mockClear();
    rerender(<DestinationPicker capture={capture} threads={threads} onChoose={vi.fn()}
      onClose={onClose} returnFocus={trigger} />);
    fireEvent.click(screen.getByTestId("destination-picker-scrim"));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    fireEvent.click(within(screen.getByRole("dialog", { name: "Choose a place" }))
      .getByRole("button", { name: "Close destination picker" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    trigger.remove();
  });

  it("uses trimmed search text as a bounded new Thread name and asks for a name when empty", () => {
    const onChoose = vi.fn();
    render(<DestinationPicker capture={capture} threads={threads} onChoose={onChoose} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Choose a place" });
    const search = within(dialog).getByRole("searchbox", { name: "Find a thread" });

    fireEvent.change(search, { target: { value: `  ${"Named subject ".repeat(12)}  ` } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create new thread" }));
    expect(onChoose).toHaveBeenCalledWith({
      kind: "thread",
      threadId: null,
      threadName: expect.stringMatching(/^Named subject/),
    });
    expect(onChoose.mock.calls[0][0].threadName.length).toBeLessThanOrEqual(100);

    onChoose.mockClear();
    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create new thread" }));
    const name = within(dialog).getByRole("textbox", { name: "Thread name" });
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: "  Explicit name  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Thread" }));
    expect(onChoose).toHaveBeenCalledWith({ kind: "thread", threadId: null, threadName: "Explicit name" });
  });

  it("keeps keyboard focus within the modal sheet", () => {
    render(<DestinationPicker capture={capture} threads={threads} onChoose={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Choose a place" });
    const focusable = within(dialog).getAllByRole("button");
    const last = focusable.at(-1)!;
    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close destination picker" }));

    const close = within(dialog).getByRole("button", { name: "Close destination picker" });
    close.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
