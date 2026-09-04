/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyPrompt } from "./CopyPrompt";
import { Landing } from "@/app/Landing";
import {
  GROQ_KEYS_URL,
  INSTALL_PROMPT,
  SETUP_GUIDE_URL,
} from "@/lib/install";

/* ── clipboard helpers ───────────────────────────────────────────────────── */

function withClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  /* Reset to a working clipboard between tests. */
  withClipboard(vi.fn().mockResolvedValue(undefined));
  Object.defineProperty(document, "execCommand", {
    value: vi.fn().mockReturnValue(false),
    writable: true,
    configurable: true,
  });
});

afterEach(cleanup);

/* ── prompt content (safety boundary) ───────────────────────────────────── */

describe("INSTALL_PROMPT safety boundaries", () => {
  it("tells the agent to send the person to npm run setup for the secret", () => {
    expect(INSTALL_PROMPT).toMatch(/npm run setup/);
    expect(INSTALL_PROMPT).toMatch(/terminal/i);
  });

  it("explicitly forbids pasting an API key into chat", () => {
    expect(INSTALL_PROMPT).toMatch(/do not ask me to paste an api key into chat/i);
  });

  it("explicitly forbids printing, storing, or committing a key", () => {
    expect(INSTALL_PROMPT).toMatch(/do not print, store, or commit a key/i);
  });

  it("forbids deployment or public exposure without a new request", () => {
    expect(INSTALL_PROMPT).toMatch(/do not deploy it, expose it to the internet/i);
    expect(INSTALL_PROMPT).toMatch(/unless I ask/);
  });
});

/* ── component: copy success ─────────────────────────────────────────────── */

describe("CopyPrompt — copy success", () => {
  it("shows 'Copy prompt' initially", () => {
    render(<CopyPrompt />);
    expect(screen.getByRole("button")).toHaveProperty("textContent", "Copy prompt");
  });

  it("shows 'Copied' and a confirmation after successful copy", async () => {
    render(<CopyPrompt />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByRole("button").textContent).toBe("Copied");
    });
    expect(screen.getByText("Copied to clipboard")).toBeTruthy();
  });

  it("writes the exact prompt to the clipboard", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    withClipboard(write);
    render(<CopyPrompt />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(write).toHaveBeenCalledWith(INSTALL_PROMPT);
  });

  it("uses the selection fallback when the async clipboard is denied", async () => {
    withClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    Object.defineProperty(document, "execCommand", {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
    });
    render(<CopyPrompt />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByRole("button").textContent).toBe("Copied");
    });
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });
});

/* ── component: copy failure ─────────────────────────────────────────────── */

describe("CopyPrompt — copy failure", () => {
  it("shows a failure label when the clipboard is unavailable", async () => {
    withClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    render(<CopyPrompt />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByRole("button").textContent).toBe("Copy failed");
    });
    expect(screen.getByText(/select and copy the text above/i)).toBeTruthy();
  });

  it("keeps the prompt text selectable on failure", async () => {
    withClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    render(<CopyPrompt />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toBe("Copy failed")
    );
    /* The pre element remains in the DOM and selectable. */
    expect(screen.getByLabelText(/install prompt/i)).toBeTruthy();
  });
});

/* ── rendered section links ──────────────────────────────────────────────── */

describe("install section links", () => {
  it("renders the official Groq key page and the full setup guide", () => {
    render(<Landing />);
    expect(
      screen.getByRole("link", { name: "the Groq console" }).getAttribute("href")
    ).toBe(GROQ_KEYS_URL);
    expect(
      screen
        .getByRole("link", {
          name: "Phone, hosting, and fallback-provider setup",
        })
        .getAttribute("href")
    ).toBe(SETUP_GUIDE_URL);
  });
});
