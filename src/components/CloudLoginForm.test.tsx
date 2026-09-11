/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCloudBrowserClient } from "@/lib/supabase/browser";
import { CloudLoginForm } from "./CloudLoginForm";

vi.mock("@/lib/supabase/browser", () => ({
  createCloudBrowserClient: vi.fn(),
}));

const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();

beforeEach(() => {
  vi.mocked(createCloudBrowserClient).mockReturnValue({
    auth: { signInWithOtp, verifyOtp },
  } as never);
  signInWithOtp.mockReset();
  verifyOtp.mockReset();
});

afterEach(cleanup);

describe("CloudLoginForm", () => {
  it("emails a code and never asks Supabase for a magic-link redirect", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    render(
      <CloudLoginForm
        config={{ status: "ready", url: "https://capture.supabase.co", publishableKey: "sb_publishable_test" }}
      />
    );

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "gleb@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));

    await screen.findByText("Enter the code sent to gleb@example.com.");
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "gleb@example.com",
      options: { shouldCreateUser: true },
    });
    expect(screen.getByLabelText("Verification code").getAttribute("autocomplete")).toBe("one-time-code");
  });

  it("verifies the email and an eight-digit project code", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    verifyOtp.mockResolvedValue({ error: null, data: { session: { access_token: "session" } } });
    const onAuthenticated = vi.fn();
    render(
      <CloudLoginForm
        config={{ status: "ready", url: "https://capture.supabase.co", publishableKey: "sb_publishable_test" }}
        onAuthenticated={onAuthenticated}
      />
    );

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "gleb@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    const codeInput = await screen.findByLabelText("Verification code");

    expect(codeInput.getAttribute("maxlength")).toBe("10");
    expect(codeInput.getAttribute("pattern")).toBe("[0-9]{6,10}");
    fireEvent.change(codeInput, {
      target: { value: "12345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open Capture" }));

    await waitFor(() =>
      expect(verifyOtp).toHaveBeenCalledWith({
        email: "gleb@example.com",
        token: "12345678",
        type: "email",
      })
    );
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
  });

  it("lets someone correct the email address without requesting another code", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    render(
      <CloudLoginForm
        config={{ status: "ready", url: "https://capture.supabase.co", publishableKey: "sb_publishable_test" }}
      />
    );

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "wrong@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText("Verification code");
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));

    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
  });

  it("recovers when Supabase throws while verifying a code", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    verifyOtp.mockRejectedValue(new Error("storage unavailable"));
    render(
      <CloudLoginForm
        config={{ status: "ready", url: "https://capture.supabase.co", publishableKey: "sb_publishable_test" }}
      />
    );

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "gleb@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText("Verification code");
    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: "12345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open Capture" }));

    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't verify that code. Request a new one.");
    expect(screen.getByRole("button", { name: "Open Capture" }).hasAttribute("disabled")).toBe(false);
  });
});