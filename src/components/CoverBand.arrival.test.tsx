/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CoverBand } from "./cards";
import { imgSave, _clearImgCache } from "@/lib/imgCache";

afterEach(() => { cleanup(); _clearImgCache(); });

it("shows a cover photo that arrives after the cover was drawn", async () => {
  // A new device: the board (with the photo's id) lands first, the bytes later.
  const { container } = render(<CoverBand cover={{ kind: "img", id: "late-photo" }} />);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(container.querySelector("img")).toBeNull();

  await act(async () => { await imgSave("late-photo", "data:image/png;base64,AAAA"); });
  await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA"));
});
