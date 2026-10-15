/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/lib/model";
import { imgLoad } from "@/lib/imgCache";
import { CaptureProfile } from "./CaptureProfile";

const { shrinkFileMock } = vi.hoisted(() => ({ shrinkFileMock: vi.fn() }));
vi.mock("@/lib/shrink", () => ({ shrinkFile: shrinkFileMock }));

const threads: Thread[] = [
  {
    id: "capture",
    name: "Capture.",
    summary: "A thinking system shaped through daily use.",
    frags: [{ id: "f1", at: 1, text: "first" }],
  },
];

describe("CaptureProfile", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    shrinkFileMock.mockReset();
  });

  it("keeps the empty portrait quiet while the whole well remains tappable", () => {
    render(
      <CaptureProfile
        threads={threads}
        onOpenThread={() => {}}
        defaults={{ name: "Gleb", image: "" }}
        storageKey="capture:test-empty-profile"
      />
    );

    expect(screen.getByRole("button", { name: "Add profile image" })).toBeTruthy();
    expect(screen.queryByText("Add photo")).toBeNull();
  });

  it("moves a phone-local profile into the synced board", async () => {
    const storageKey = "capture:test-profile-migration";
    const image = "data:image/webp;base64,PHONE";
    localStorage.setItem(storageKey, JSON.stringify({ name: "Phone Gleb", image }));
    const onProfileChange = vi.fn().mockResolvedValue(undefined);
    const props = {
      threads,
      onOpenThread: () => {},
      defaults: { name: "", image: "" },
      storageKey,
      profile: undefined,
      onProfileChange,
    };
    const { rerender } = render(
      <CaptureProfile {...props} migrationReady={false} />
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onProfileChange).not.toHaveBeenCalled();
    rerender(<CaptureProfile {...props} migrationReady />);

    await waitFor(() => expect(onProfileChange).toHaveBeenCalledTimes(1));
    const migrate = onProfileChange.mock.calls[0][0];
    expect(migrate).toEqual(expect.any(Function));
    const remote = {
      name: "Synced Gleb",
      imageId: "synced-photo",
      showSignature: true,
    };
    expect(migrate(remote)).toEqual(remote);
    const migrated = migrate({ name: "" });
    expect(migrated).toMatchObject({
      name: "Phone Gleb",
      showSignature: false,
    });
    expect(migrated.imageId).toEqual(expect.any(String));
    expect(await imgLoad(migrated.imageId!)).toBe(image);
    expect(localStorage.getItem(storageKey)).toBe(
      JSON.stringify({ name: "Phone Gleb", image })
    );
  });

  it("keeps signature controls out of The Record profile", () => {
    render(
      <CaptureProfile
        threads={threads}
        onOpenThread={() => {}}
        defaults={{ name: "", image: "" }}
        profile={{ name: "Gleb", showSignature: false, updatedAt: 100 }}
        onProfileChange={vi.fn()}
        storageKey="capture:test-signature-toggle"
      />
    );

    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("keeps newer profile edits when a slow photo resize finishes", async () => {
    let finishResize!: (src: string) => void;
    shrinkFileMock.mockReturnValue(
      new Promise<string>((resolve) => {
        finishResize = resolve;
      })
    );
    const onProfileChange = vi.fn().mockResolvedValue(undefined);
    const props = {
      threads,
      onOpenThread: () => {},
      defaults: { name: "", image: "" },
      onProfileChange,
      storageKey: "capture:test-slow-photo",
    };
    const { container, rerender } = render(
      <CaptureProfile
        {...props}
        profile={{ name: "Gleb", showSignature: false, updatedAt: 100 }}
      />
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, {
      target: { files: [new File(["photo"], "portrait.png", { type: "image/png" })] },
    });

    rerender(
      <CaptureProfile
        {...props}
        profile={{ name: "Ada", showSignature: true, updatedAt: 200 }}
      />
    );
    finishResize("data:image/webp;base64,NEW");

    await waitFor(() => expect(onProfileChange).toHaveBeenCalledTimes(1));
    const update = onProfileChange.mock.calls[0][0];
    expect(update).toEqual(expect.any(Function));
    expect(
      update({ name: "Ada", imageId: undefined, showSignature: true })
    ).toEqual({
      name: "Ada",
      imageId: expect.any(String),
      showSignature: true,
    });
  });

  it("keeps the title visible while the chevron hides the profile", () => {
    render(
      <CaptureProfile
        threads={threads}
        onOpenThread={() => {}}
        defaults={{ name: "Gleb", image: "/gleb.jpg" }}
        storageKey="capture:test-profile"
      />
    );

    expect(screen.getByDisplayValue("Gleb")).toBeTruthy();
    const toggle = screen.getByRole("button", {
      name: "Hide your Capture profile",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggle);

    expect(screen.queryByDisplayValue("Gleb")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show your Capture profile" })
    ).toBeTruthy();
    expect(screen.getByText("Your Capture")).toBeTruthy();
  });
});

describe("Your voice", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  const spoken = (count: number) => Array.from({ length: count }, (_, index) => ({
    id: `e${index}`, captureId: `c${index}`, at: index, kind: "thread" as const, source: "dictated" as const, targetId: "capture", clean: "",
    raw: `okay so I think number ${index} is basically about reducing friction, right? ${"and then I keep going on about it ".repeat(4)}`,
  }));
  const voice = {
    patterns: ["You open with Okay or So.", "You check yourself with right?", "You land on So yeah."],
    phrases: ["reducing friction"],
    samples: [{ about: "Capture.", text: "Okay so the thing with Capture is I just talk and it lands." }],
    words: 6_000, at: 1,
  };

  it("shows how you talk once there is a reading, and nothing before", () => {
    const { rerender } = render(<CaptureProfile threads={threads} onOpenThread={() => {}} defaults={{ name: "Gleb", image: "" }} profile={{ name: "Gleb" }} />);
    expect(screen.queryByText("Your voice")).toBeNull();
    rerender(<CaptureProfile threads={threads} onOpenThread={() => {}} defaults={{ name: "Gleb", image: "" }} profile={{ name: "Gleb", voice }} />);
    expect(screen.getByText("Your voice")).toBeTruthy();
    expect(screen.getByText("You open with Okay or So.")).toBeTruthy();
    expect(screen.getByText("“reducing friction”")).toBeTruthy();
    expect(screen.getByText(/the thing with Capture is I just talk/)).toBeTruthy();
  });

  it("reads your voice quietly when there is enough and keeps it on the profile", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ voice }));
    vi.stubGlobal("fetch", fetchMock);
    const onProfileChange = vi.fn().mockResolvedValue(undefined);
    render(<CaptureProfile threads={threads} onOpenThread={() => {}} defaults={{ name: "Gleb", image: "" }}
      profile={{ name: "Gleb" }} onProfileChange={onProfileChange} ledger={spoken(200)} />);
    await waitFor(() => expect(onProfileChange).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/voice");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.words).toBeGreaterThanOrEqual(5_000);
    expect(body.recurring).toEqual(["Capture."]);
    expect(onProfileChange.mock.calls[0][0]({ name: "Gleb" })).toEqual({ name: "Gleb", voice });
  });

  it("does not ask before there is enough to hear", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<CaptureProfile threads={threads} onOpenThread={() => {}} defaults={{ name: "Gleb", image: "" }}
      profile={{ name: "Gleb" }} onProfileChange={vi.fn()} ledger={spoken(10)} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
