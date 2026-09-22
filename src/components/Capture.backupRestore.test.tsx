/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Capture } from "@/app/Capture";
import { EMPTY, KEY } from "@/lib/model";
import { del, keys, set } from "@/lib/storage";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

beforeEach(async () => {
  for (const key of await keys()) await del(key);
  await set(KEY, JSON.stringify(EMPTY));
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps the real Settings screen open when Back is pressed during restore", async () => {
  const view = render(<Capture />);
  await screen.findByText("No open loops.");
  fireEvent.click(screen.getByRole("button", { name: "Settings and backup" }));
  fireEvent.click(screen.getByRole("button", { name: "Show Restore" }));

  let finish!: (text: string) => void;
  const file = new File([""], "held-backup.json", { type: "application/json" });
  Object.defineProperty(file, "text", {
    value: () => new Promise<string>((resolve) => { finish = resolve; }),
  });
  const input = view.container.querySelector<HTMLInputElement>('input[accept="application/json,.json"]')!;
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByText("Opening backup…");

  fireEvent.click(screen.getByRole("button", { name: "← back" }));
  expect(screen.getByText("Settings")).toBeTruthy();
  expect(screen.getByText(/Restore is still finishing/)).toBeTruthy();

  finish("not json");
  await screen.findByText(/isn't readable as JSON/);
  fireEvent.click(screen.getByRole("button", { name: "← back" }));
  await waitFor(() => expect(screen.queryByText("Settings")).toBeNull());
});
