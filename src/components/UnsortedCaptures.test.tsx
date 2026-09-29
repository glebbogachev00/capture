/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IMG, type Action, type Thread } from "@/lib/model";
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

const threads: Thread[] = [
  { id: "old", name: "Old notes", summary: "", frags: [], updatedAt: 1 },
  { id: "capture", name: "Capture", summary: "", frags: [], updatedAt: 3 },
  { id: "retake", name: "Retake", summary: "", frags: [], updatedAt: 2 },
];

function expandWaiting() {
  fireEvent.click(screen.getByRole("button", { name: /^Unsorted \d+$/ }));
}

function card(container: HTMLElement, index = 0) {
  return container.querySelectorAll(".unsorted-card")[index] as HTMLElement;
}

function openSecondary(target: HTMLElement) {
  fireEvent.click(within(target).getByRole("button", { name: "More" }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Unsorted captures", () => {
  it("dismisses More with Escape or outside click and returns focus to its trigger", () => {
    render(<UnsortedCaptures items={[item("one", "Secondary actions")]} busy={false}
      onSort={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expandWaiting();
    const trigger = screen.getByRole("button", { name: "More" });
    fireEvent.click(trigger);
    const options = screen.getByRole("group", { name: "More options" });
    within(options).getByRole("button", { name: "Edit" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "More options" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("group", { name: "More options" })).toBeNull();
  });
  it("collapses waiting captures into the quiet Unsorted title toggle by default", () => {
    const { container } = render(<UnsortedCaptures
      items={[item("one", "First"), item("two", "Second"), item("three", "Third"), item("four", "Fourth")]}
      busy={false} onSort={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);

    const summary = screen.getByRole("button", { name: "Unsorted 4" });
    expect(summary.classList.contains("unsorted-summary")).toBe(true);
    expect(within(summary).getByText("Unsorted").classList.contains("unsorted-title-label")).toBe(true);
    expect(within(summary).getByText("4").classList.contains("unsorted-count")).toBe(true);
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".unsorted-panel")).toBeNull();
    expect(container.querySelector(".unsorted-card")).toBeNull();
    expect(screen.queryByText("First")).toBeNull();
  });

  it("expands into a stacked list with one quiet saved message", () => {
    const { container } = render(<UnsortedCaptures
      items={[item("one", "The capture stays primary."), item("two", "The next card remains visible sideways.")]}
      busy={false} threads={threads} onSort={vi.fn()} onManualSort={vi.fn()}
      onEdit={vi.fn()} onDelete={vi.fn()} />);

    expandWaiting();

    const summary = screen.getByRole("button", { name: "Unsorted 2" });
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    const panel = container.querySelector(".unsorted-panel") as HTMLElement;
    const track = within(panel).getByRole("list", { name: "Unsorted captures" });
    expect(track.classList.contains("unsorted-track")).toBe(true);
    expect(within(track).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Sort later" })).toBeNull();
    expect(screen.getAllByText("Saved. Sort later or choose a place.")).toHaveLength(1);

    const target = card(container);
    expect(target.getAttribute("role")).toBe("listitem");
    expect(within(target).getByText("The capture stays primary.").classList.contains("unsorted-preview")).toBe(true);
    expect(within(target).getByRole("button", { name: "Choose a place" })).toBeTruthy();
    expect(within(target).getByRole("button", { name: "More" }).querySelector("svg")).toBeTruthy();
    for (const rejected of ["Action", "Intention", "Thread", "Split manually"]) {
      expect(within(target).queryByRole("button", { name: rejected })).toBeNull();
    }
    expect(container.querySelectorAll(".unsorted-primary")).toHaveLength(2);
  });

  it("the section toggle is the only way to collapse the expanded queue", () => {
    render(<UnsortedCaptures items={[item("one", "Keep this safe")]} busy={false}
      threads={threads} onSort={vi.fn()} onManualSort={vi.fn()}
      onEdit={vi.fn()} onDelete={vi.fn()} />);
    expandWaiting();

    const summary = screen.getByRole("button", { name: "Unsorted 1" });
    fireEvent.click(summary);
    expect(screen.queryByText("Keep this safe")).toBeNull();
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(summary);
    expect(screen.getByText("Keep this safe")).toBeTruthy();
  });

  it("requests the one screen-level destination picker without expanding the card", () => {
    const onChoosePlace = vi.fn();
    const { container } = render(<UnsortedCaptures items={[item("one", "Place this thought")]} busy={false}
      threads={threads} onSort={vi.fn()} onManualSort={vi.fn()} onChoosePlace={onChoosePlace}
      onEdit={vi.fn()} onDelete={vi.fn()} />);
    expandWaiting();
    const target = card(container);
    const trigger = within(target).getByRole("button", { name: "Choose a place" });

    fireEvent.click(trigger);
    expect(onChoosePlace).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }), trigger);
    expect(within(target).queryByRole("dialog", { name: "Choose a place" })).toBeNull();
    expect(target.querySelector(".unsorted-place-picker")).toBeNull();
  });

  it("keeps the compact trigger available while filing is not finalizing", async () => {
    const onChoosePlace = vi.fn();
    const { container } = render(<UnsortedCaptures items={[item("one", "File me")]} busy={false}
      threads={threads} onSort={vi.fn()} onManualSort={vi.fn()} onChoosePlace={onChoosePlace}
      onEdit={vi.fn()} onDelete={vi.fn()} />);
    expandWaiting();
    const target = card(container);
    const trigger = within(target).getByRole("button", { name: "Choose a place" });
    fireEvent.click(trigger);
    expect(onChoosePlace).toHaveBeenCalledTimes(1);
    expect(trigger.hasAttribute("disabled")).toBe(false);
  });

  it("keeps split controls absent from the recovery card", () => {
    render(<UnsortedCaptures items={[item("one", "A new subject")]} busy={false}
      threads={threads} onSort={vi.fn()} onManualSort={vi.fn()} onManualSplit={vi.fn()}
      onEdit={vi.fn()} onDelete={vi.fn()} />);
    expandWaiting();
    expect(screen.queryByRole("button", { name: "Split manually" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: /split/i })).toBeNull();
  });

  it("keeps retry, edit, and delete quiet behind one secondary disclosure", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const { container } = render(<UnsortedCaptures items={[item("one", "Secondary actions")]} busy={false}
      threads={threads} onSort={vi.fn()} onManualSort={vi.fn()}
      onEdit={vi.fn()} onDelete={vi.fn()} />);
    expandWaiting();
    const target = card(container);

    expect(within(target).queryByRole("button", { name: "Sort now" })).toBeNull();
    expect(within(target).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(within(target).queryByRole("button", { name: "Delete" })).toBeNull();
    openSecondary(target);
    expect(within(target).getByRole("group", { name: "More options" })).toBeTruthy();
    expect(within(target).getByRole("button", { name: "Sort now" })).toBeTruthy();
    expect(within(target).getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(within(target).getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(within(target).queryByRole("button", { name: "Split manually" })).toBeNull();
  });

  it("stays quiet offline and omits an unusable retry", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { container } = render(<UnsortedCaptures items={[item("one", "Saved offline")]} busy={false}
      threads={threads} onSort={vi.fn()} onManualSort={vi.fn()}
      onEdit={vi.fn()} onDelete={vi.fn()} />);
    expandWaiting();
    const target = card(container);
    openSecondary(target);

    expect(within(target).queryByRole("button", { name: "Sort now" })).toBeNull();
    expect(within(target).getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(within(target).getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("keeps retry state local and prevents duplicate retries", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const onSort = vi.fn(() => pending);
    const { container } = render(<UnsortedCaptures
      items={[item("one", "Retry this"), item("two", "Leave this usable")]}
      busy={false} threads={threads} onSort={onSort} onManualSort={vi.fn()}
      onEdit={vi.fn()} onDelete={vi.fn()} />);
    expandWaiting();
    const first = card(container, 0);
    const second = card(container, 1);
    openSecondary(first);
    openSecondary(second);

    const retry = within(first).getByRole("button", { name: "Sort now" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(onSort).toHaveBeenCalledTimes(1);
    expect(retry.hasAttribute("disabled")).toBe(true);
    expect(within(first).getByRole("button", { name: "Choose a place" }).hasAttribute("disabled")).toBe(false);
    expect(within(second).getByRole("button", { name: "Sort now" }).hasAttribute("disabled")).toBe(false);

    finish();
    await waitFor(() => expect(retry.hasAttribute("disabled")).toBe(false));
  });

  it("keeps pictures and truthful edit/delete behavior available", async () => {
    const onEdit = vi.fn(async () => false);
    const onDelete = vi.fn(async () => true);
    await set(IMG("picture"), "data:image/png;base64,cGljdHVyZQ==");
    const { container } = render(<UnsortedCaptures
      items={[{ ...item("one", "Original source"), imgs: ["picture"] }]}
      busy={false} threads={threads} onSort={vi.fn()} onManualSort={vi.fn()}
      onEdit={onEdit} onDelete={onDelete} />);
    expandWaiting();
    const target = card(container);
    fireEvent.click(within(target).getByText("Original source"));
    await waitFor(() => expect(within(target).getByAltText("Attached capture 1")).toBeTruthy());

    openSecondary(target);
    fireEvent.click(within(target).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(target).getByLabelText("Edit unsorted capture"), { target: { value: "Unsaved edit" } });
    fireEvent.click(within(target).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith("one", "Unsaved edit"));
    expect(within(target).getByLabelText("Edit unsorted capture")).toBeTruthy();

    fireEvent.click(within(target).getByRole("button", { name: "Cancel" }));
    openSecondary(target);
    fireEvent.click(within(target).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(target).getByRole("button", { name: "Delete capture" }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }));
  });

  it("locks only the finalizing card", () => {
    const { container } = render(<UnsortedCaptures
      items={[item("one", "Finalizing"), item("two", "Still available")]}
      finalizingIds={["one"]} busy={false} threads={threads} onSort={vi.fn()} onManualSort={vi.fn()}
      onEdit={vi.fn()} onDelete={vi.fn()} />);
    expandWaiting();
    const first = card(container, 0);
    const second = card(container, 1);

    expect(within(first).getByRole("button", { name: "Choose a place" }).hasAttribute("disabled")).toBe(true);
    expect(within(first).getByRole("button", { name: "More" }).hasAttribute("disabled")).toBe(true);
    expect(within(second).getByRole("button", { name: "Choose a place" }).hasAttribute("disabled")).toBe(false);
  });

  it("renders nothing when there is nothing waiting", () => {
    const { container } = render(<UnsortedCaptures items={[]} busy={false} onSort={vi.fn()}
      onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});
