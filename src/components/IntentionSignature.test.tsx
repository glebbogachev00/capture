/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Intention, ProfileIdentity, Thread } from "@/lib/model";
import { IntentionCard } from "@/app/Intentions";
import { TCard } from "./cards";
import { _clearImgCache, imgSave } from "@/lib/imgCache";

const intention: Intention = {
  id: "i1",
  number: 4,
  rawInput: "I keep my mornings clear.",
  expandedIntention: "I keep the mornings free of anyone else's agenda.",
  recommendedActions: [],
  counterIntentions: [],
  at: 1_756_000_000_000,
  updatedAt: 1_756_000_000_000,
};
const thread: Thread = {
  id: "t1",
  name: "Reality journal",
  summary: "What keeps coordinating after the state changes.",
  frags: [{ id: "f1", text: "First entry", at: 1_756_000_000_000 }],
};

afterEach(() => {
  cleanup();
  _clearImgCache();
});

describe("card profile signature", () => {
  it("shows the synced profile on both Intention and Thread cards", () => {
    const profile = {
      name: "Gleb",
      showSignature: true,
      updatedAt: 100,
    } satisfies ProfileIdentity;
    render(
      <>
        <IntentionCard intention={intention} onOpen={() => {}} profile={profile} />
        <TCard t={thread} onOpen={() => {}} profile={profile} />
      </>
    );

    expect(screen.getAllByText("Gleb")).toHaveLength(2);
    expect(screen.getAllByLabelText("Personalized for Gleb")).toHaveLength(2);
  });

  it("shows a profile photo when its synced bytes arrive after render", async () => {
    const { container } = render(
      <IntentionCard
        intention={intention}
        onOpen={() => {}}
        profile={{
          name: "Gleb",
          imageId: "late-profile-photo",
          showSignature: true,
          updatedAt: 100,
        }}
      />
    );
    expect(container.querySelector(".int-signature-mark img")).toBeNull();

    await imgSave("late-profile-photo", "data:image/webp;base64,LATE");

    await waitFor(() =>
      expect(
        container.querySelector<HTMLImageElement>(".int-signature-mark img")?.src
      ).toBe("data:image/webp;base64,LATE")
    );
  });

  it("leaves both card kinds unchanged while personalization is off", () => {
    const profile = {
      name: "Gleb",
      showSignature: false,
      updatedAt: 100,
    } satisfies ProfileIdentity;
    render(
      <>
        <IntentionCard intention={intention} onOpen={() => {}} profile={profile} />
        <TCard t={thread} onOpen={() => {}} profile={profile} />
      </>
    );

    expect(screen.queryByText("Gleb")).toBeNull();
    expect(screen.queryByLabelText("Personalized for Gleb")).toBeNull();
  });
});
