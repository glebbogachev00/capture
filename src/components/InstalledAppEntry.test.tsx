/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/lib/publicSite", () => ({ PUBLIC_SITE: true }));
vi.mock("@/components/OwnershipBoundary", () => ({ OwnershipBoundary: () => null }));
vi.mock("@/app/Capture", () => ({ Capture: () => null }));
vi.mock("@/app/Landing", () => ({ Landing: () => <div>Public landing</div> }));
import Home from "@/app/page";

beforeEach(() => navigation.replace.mockReset());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });

it.each([
  { mode: "browser", standalone: false, ios: false, url: "/", target: null },
  { mode: "installed", standalone: true, ios: false, url: "/", target: "/app" },
  { mode: "iOS installed", standalone: false, ios: true, url: "/", target: "/app" },
  { mode: "query and fragment", standalone: true, ios: false, url: "/?from=icon#record", target: "/app?from=icon#record" },
  { mode: "already in app", standalone: true, ios: false, url: "/app", target: null },
  { mode: "explicit page", standalone: true, ios: false, url: "/pricing", target: null },
])("handles $mode without changing the browser landing or deep links", ({ standalone, ios, url, target }) => {
  window.history.replaceState({}, "", url);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query === "(display-mode: standalone)" && standalone })));
  vi.stubGlobal("navigator", { standalone: ios });
  render(<Home />);
  if (target) expect(navigation.replace).toHaveBeenCalledWith(target);
  else {
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(screen.getByText("Public landing")).toBeTruthy();
  }
});
