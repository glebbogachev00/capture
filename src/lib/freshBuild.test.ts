import { describe, it, expect } from "vitest";
import { decide } from "./freshBuild";

const base = {
  mine: "build-1",
  served: "build-2",
  visible: true,
  composerBusy: false,
  reloadedFor: null as string | null,
};

describe("catching up to a newer build", () => {
  it("reloads when the server has moved on", () => {
    expect(decide(base)).toEqual({ reload: true, remember: "build-2" });
  });

  it("does nothing when already current", () => {
    expect(decide({ ...base, served: "build-1" })).toEqual({
      reload: false,
      because: "already-current",
    });
  });

  it("does nothing when either side has no name", () => {
    /* A build without an id must never be treated as "different from the
       server" — that reloads on every check, forever. */
    expect(decide({ ...base, mine: undefined }).reload).toBe(false);
    expect(decide({ ...base, served: undefined }).reload).toBe(false);
  });

  it("waits while the app is in the background", () => {
    expect(decide({ ...base, visible: false })).toEqual({
      reload: false,
      because: "not-visible",
    });
  });

  it("never reloads twice for the same build", () => {
    /* The loop guard. If a build id ever disagrees with itself — two
       compilations in one build, a half-rolled deployment answering from
       two versions — this is what keeps it to a single reload instead of a
       phone that reloads until the battery is flat. */
    expect(decide({ ...base, reloadedFor: "build-2" })).toEqual({
      reload: false,
      because: "already-reloaded",
    });
  });

  it("refuses to throw away something being typed", () => {
    expect(decide({ ...base, composerBusy: true })).toEqual({
      reload: false,
      because: "composer-busy",
    });
  });

  it("still catches up once the composer is clear", () => {
    /* Waiting for the composer must not mark the build as handled, or a
       single half-typed capture strands the app on an old build for the
       rest of the session. */
    const waited = decide({ ...base, composerBusy: true });
    expect(waited.reload).toBe(false);
    expect(decide({ ...base, composerBusy: false })).toEqual({
      reload: true,
      remember: "build-2",
    });
  });

  it("reloads again when a THIRD build appears", () => {
    expect(decide({ ...base, served: "build-3", reloadedFor: "build-2" })).toEqual({
      reload: true,
      remember: "build-3",
    });
  });
});
