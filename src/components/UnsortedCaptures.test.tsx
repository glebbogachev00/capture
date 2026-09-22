/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IMG, type Action } from "@/lib/model";
import { set } from "@/lib/storage";
import { UnsortedCaptures } from "./UnsortedCaptures";

const item = (id: string, text: string): Action => ({
  id,
  text,
  done: false,
  at: 1,
  shelf: "keep",
  expires: null,
  unsorted: true,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Unsorted captures", () => {
  it("renders a compact strip with expandable full text, pictures, editing, deletion and sorting", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const onSort = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const long = "A very long offline capture that must remain intact even when its visual preview is clamped.";
    await set(IMG("picture"), "data:image/png;base64,cGljdHVyZQ==");
    const { container } = render(
      <UnsortedCaptures
        items={[{ ...item("one", long), imgs: ["picture"] }, item("two", "Second capture")]}
        busy={false}
        onSort={onSort}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByRole("heading", { name: "Unsorted 2" })).toBeTruthy();
    const first = container.querySelectorAll(".unsorted-card")[0] as HTMLElement;
    fireEvent.click(within(first).getAllByText(long)[0]);
    expect(within(first).getAllByText(long)).toHaveLength(1);
    expect(within(first).getByText(long).classList.contains("unsorted-preview")).toBe(true);
    await waitFor(() => expect(screen.getByAltText("Attached capture 1")).toBeTruthy());
    expect(container.querySelector(".unsorted-track")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /shelf/i })).toBeNull();

    const buttons = screen.getAllByRole("button", { name: "Sort now" });
    fireEvent.click(buttons[1]);
    expect(onSort).toHaveBeenCalledWith(expect.objectContaining({ id: "two" }));

    fireEvent.click(within(first).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(first).getByLabelText("Edit unsorted capture"), { target: { value: "Edited capture" } });
    fireEvent.click(within(first).getByRole("button", { name: "Save" }));
    expect(onEdit).toHaveBeenCalledWith("one", "Edited capture");
    await waitFor(() => expect(within(first).queryByLabelText("Edit unsorted capture")).toBeNull());

    fireEvent.click(within(first).getByRole("button", { name: "Delete" }));
    const deleteButtons = within(first).getAllByRole("button", { name: "Delete" });
    fireEvent.click(deleteButtons.at(-1)!);
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }));
  });

  it("stays quiet offline and exposes no unusable Sort action", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { container } = render(<UnsortedCaptures items={[item("one", "Saved offline")]} busy={false} onSort={vi.fn()}
      onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Unsorted 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sort now" })).toBeNull();
    fireEvent.click(within(container).getAllByText("Saved offline")[0]);
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("locks editing and deletion while a sort is in flight", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const { container } = render(<UnsortedCaptures items={[item("one", "Sorting now")]} busy
      onSort={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(within(container).getByText("Sorting now"));
    expect(screen.getByRole("button", { name: "Edit" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Delete" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Sort now" }).hasAttribute("disabled")).toBe(true);
  });

  it("opens the editor with the latest same-id source from sync", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const props = { busy: false, onSort: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() };
    const { container, rerender } = render(
      <UnsortedCaptures items={[item("one", "Original source")]} {...props} />,
    );
    fireEvent.click(within(container).getByText("Original source"));
    rerender(<UnsortedCaptures items={[item("one", "Synced source")]} {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((screen.getByLabelText("Edit unsorted capture") as HTMLTextAreaElement).value)
      .toBe("Synced source");
  });

  it("renders nothing when there is nothing waiting", () => {
    const { container } = render(<UnsortedCaptures items={[]} busy={false} onSort={vi.fn()}
      onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});
