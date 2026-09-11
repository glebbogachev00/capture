/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyPrompt } from "./CopyPrompt";
import { Landing } from "@/app/Landing";
import InstallPage from "@/app/install/page";
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
    render(<InstallPage />);
    expect(
      screen.getByRole("link", { name: "View on GitHub" }).getAttribute("href")
    ).toBe("https://github.com/glebbogachev00/capture");
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

  it("includes optional voice-typing guidance on the install page", () => {
    render(<InstallPage />);
    expect(
      screen.getByRole("heading", { name: "Add voice typing when you want it." })
    ).toBeTruthy();
    expect(screen.getByText(/apple dictation works without extra setup/i)).toBeTruthy();
    for (const name of ["LocalWhisper", "Wispr Flow", "Hex", "Handy"]) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
    }
  });

  it("keeps setup off the sales page and links to the local-install page", () => {
    const { container } = render(<Landing />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Messy thoughts that sort themselves.",
      })
    ).toBeTruthy();
    expect(screen.queryByLabelText(/install prompt/i)).toBeNull();
    expect(
      screen
        .getAllByRole("link", { name: "Install locally" })
        .every((link) => link.getAttribute("href") === "/install")
    ).toBe(true);

    const navigation = screen.getByRole("navigation", { name: "Capture links" });
    expect(within(navigation).queryByRole("button")).toBeNull();
    expect(within(navigation).getByRole("link", { name: "About" }).getAttribute("aria-current"))
      .toBe("page");
    const heroActions = container.querySelector(".site-hero .site-actions");
    expect(heroActions).toBeTruthy();
    expect(within(heroActions as HTMLElement).getByRole("link", { name: "Open Capture" }))
      .toBeTruthy();
    expect(within(heroActions as HTMLElement).getByRole("link", { name: "Install locally" }))
      .toBeTruthy();
  });

  it("serves lightweight poster images for the folded demos", () => {
    const { container } = render(<Landing />);
    const posters = [...container.querySelectorAll(".reel-more video")].map((video) =>
      video.getAttribute("poster")
    );

    expect(posters).toEqual(["/demos/it-learns.webp", "/demos/next-step.webp"]);
  });

  it("presents voice typing as its own scannable usage section", () => {
    const { container } = render(<Landing />);

    expect(
      screen.getByRole("heading", { name: "How to use Capture best" })
    ).toBeTruthy();
    expect(container.querySelector('[data-move="how-to"]')).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Use the voice typing you already have." })
    ).toBeTruthy();
    for (const platform of [
      "Built into Apple devices",
      "iPhone",
      "Apple-silicon Mac",
      "Windows, Mac, and Linux",
    ]) {
      expect(screen.getByText(platform)).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: "LocalWhisper" }).getAttribute("href"))
      .toBe("https://apps.apple.com/app/localwhisper/id6760680371");
    expect(screen.getByRole("link", { name: "Wispr Flow" }).getAttribute("href"))
      .toBe("https://wisprflow.ai/");
    expect(screen.getByRole("link", { name: "Hex" }).getAttribute("href"))
      .toBe("https://github.com/kitlangton/Hex");
    expect(screen.getByRole("link", { name: "Handy" }).getAttribute("href"))
      .toBe("https://handy.computer/");
    expect(screen.queryByText(/works best with/i)).toBeNull();
  });
});
