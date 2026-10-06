// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useBoardCarry } from "@/hooks/useNativeShell";
import { PhoneBoardOffer } from "./PhoneBoardOffer";

function bridge(exists: boolean) {
  const methods: string[] = [];
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    nativePromise: async (_plugin: string, method: string) => {
      methods.push(method);
      if (method === "hasStashedBoard") return { exists };
      if (method === "takeStashedBoard") return { json: "{}" };
      return {};
    },
  };
  return methods;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

it("stays hidden in a browser", () => {
  const { container } = render(<PhoneBoardOffer />);
  expect(container.innerHTML).toBe("");
});

it("stays hidden when no board was kept", async () => {
  const methods = bridge(false);
  const { container } = render(<PhoneBoardOffer />);
  await waitFor(() => expect(methods).toContain("hasStashedBoard"));
  expect(container.innerHTML).toBe("");
});

it("brings the kept board in with one tap, then goes away", async () => {
  bridge(true);
  const restore = vi.fn(async () => true);
  renderHook(() => useBoardCarry(vi.fn(), restore));
  render(<PhoneBoardOffer />);
  const bringIn = await screen.findByRole("button", { name: "Bring it in" });
  await act(async () => { fireEvent.click(bringIn); });
  await waitFor(() => expect(screen.queryByText(/free version/)).toBeNull());
  expect(restore).toHaveBeenCalledTimes(1);
});

it("says so when it didn't work, and can be put off", async () => {
  bridge(true);
  renderHook(() => useBoardCarry(vi.fn(), async () => undefined));
  render(<PhoneBoardOffer />);
  const bringIn = await screen.findByRole("button", { name: "Bring it in" });
  await act(async () => { fireEvent.click(bringIn); });
  expect(await screen.findByText(/That didn't work/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(screen.queryByText(/free version/)).toBeNull();
});
