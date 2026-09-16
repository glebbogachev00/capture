// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LoginForm } from "@/app/login/LoginForm";
import { LOGOUT_PENDING_KEY } from "@/lib/ownership";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

it.each([200, 403])("password authentication %s clears the logout interlock only on success", async status => {
  localStorage.setItem(LOGOUT_PENDING_KEY, "failed-logout");
  const location = { href: "/login" };
  vi.stubGlobal("location", location);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Wrong password" }, { status })));
  render(<LoginForm />);
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "test-fixture" } });
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  if (status === 200) {
    await waitFor(() => expect(location.href).not.toBe("/login"));
    expect(localStorage.getItem(LOGOUT_PENDING_KEY)).toBeNull();
  } else {
    await screen.findByText("Wrong password");
    expect(localStorage.getItem(LOGOUT_PENDING_KEY)).toBe("failed-logout");
    expect(location.href).toBe("/login");
  }
});
