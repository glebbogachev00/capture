import { describe, expect, it } from "vitest";
import { acceptNamed, acceptTasks, isRunOnAction, pointsBack, splitActions } from "./actionText";
import type { SimpleSortItem } from "./simpleSort";

const runOn = "Create a Retake account on mail.com using my Apple account, set up Facebook integration, configure automation, and assign a specific personality and content type.";

describe("run-on actions", () => {
  it("only long actions are sent", () => {
    expect(isRunOnAction({ kind: "action", text: runOn })).toBe(true);
    expect(isRunOnAction({ kind: "action", text: "Check the heater" })).toBe(false);
    expect(isRunOnAction({ kind: "thought", text: runOn, threads: [{ id: "t" }] })).toBe(false);
  });

  it("accepts short tasks made of the action's own words", () => {
    expect(acceptTasks(runOn, ["Create a Retake account on mail.com", "set up Facebook integration", "Configure automation", "Assign a personality and content type"]))
      .toEqual(["Create a Retake account on mail.com", "Set up Facebook integration", "Configure automation", "Assign a personality and content type"]);
  });

  it("treats word forms as the same word", () => {
    const action = "Refine the two recording methods for Retake, including selecting voices and enabling an agent";
    expect(acceptTasks(action, ["Refine the recording method for Retake", "Select voices", "Enable an agent"]))
      .toEqual(["Refine the recording method for Retake", "Select voices", "Enable an agent"]);
    expect(acceptTasks("Use Retake daily or a few times per week", ["Use Retake daily or weekly"])).toEqual(["Use Retake daily or weekly"]);
  });

  it("refuses invented words, long tasks, too many tasks or one-word tasks", () => {
    expect(acceptTasks(runOn, ["Create a Gmail account"])).toBeNull();
    expect(acceptTasks(runOn, [runOn])).toBeNull();
    expect(acceptTasks(runOn, ["Create account", "Set up Facebook", "Configure automation", "Assign personality", "Assign content type"])).toBeNull();
    expect(acceptTasks(runOn, ["Configure"])).toBeNull();
  });
});

describe("splitting into actions", () => {
  const long: SimpleSortItem = { kind: "action", text: runOn, due: "2026-10-05" };
  const thought: SimpleSortItem = { kind: "thought", text: "Context.", threads: [{ id: "t" }] };

  it("replaces a run-on action with its tasks, which keep the due date", () => {
    expect(splitActions([thought, long], new Map([[long, ["Create a Retake account", "Configure automation"]]]))).toEqual([
      thought,
      { kind: "action", text: "Create a Retake account", due: "2026-10-05" },
      { kind: "action", text: "Configure automation", due: "2026-10-05" },
    ]);
  });

  it("keeps a repeat of an existing action as one line", () => {
    const repeat: SimpleSortItem = { kind: "action", text: runOn, existingActionId: "a1" };
    expect(splitActions([repeat], new Map([[repeat, ["Create a Retake account", "Configure automation"]]])))
      .toEqual([{ kind: "action", text: "Create a Retake account", existingActionId: "a1" }]);
  });

  it("leaves everything else alone", () => {
    expect(splitActions([thought, long], new Map())).toEqual([thought, long]);
  });
});

describe("an action that ends on 'it'", () => {
  const action = (text: string, extra: Partial<SimpleSortItem> = {}): SimpleSortItem => ({ kind: "action", text, ...extra });

  it("is sent only when short and ending on what the capture explains", () => {
    expect(pointsBack(action("Let aside run it"))).toBe(true);
    expect(pointsBack(action("Post about this."))).toBe(true);
    expect(pointsBack(action("Post it on X"))).toBe(true);
    expect(pointsBack(action("Send it to Mia for review"))).toBe(true);
    expect(pointsBack(action("Schedule them"))).toBe(true);
    expect(pointsBack(action("Call Mia"))).toBe(false);
    expect(pointsBack(action("Check that the build passes"))).toBe(false);
    expect(pointsBack(action("Let aside run it", { existingActionId: "a1" }))).toBe(false);
    expect(pointsBack({ kind: "thought", text: "Ship it", threads: [{ id: "t" }] })).toBe(false);
    /* Real captures where the word is explained inside its own sentence. */
    expect(pointsBack(action("Decide whether to let a site post on Zalo or create a document with all the posts and allow them to post instead"))).toBe(false);
    expect(pointsBack(action("And if it doesn't work, there needs to be a fast way to do it manually."))).toBe(false);
  });

  it("accepts a rewrite that names it in the capture's own words", () => {
    const note = "Create instagram page for Capture and let aside run it";
    expect(acceptNamed(note, "Let aside run it", "let Aside run the Instagram page.")).toBe("Let Aside run the Instagram page");
    expect(acceptNamed(note, "Let aside run it", "Let Aside run the Capture Instagram page")).toBe("Let Aside run the Capture Instagram page");
  });

  it("refuses invented words, a rewrite that still says 'it', or a long one", () => {
    const note = "Create instagram page for Capture and let aside run it";
    expect(acceptNamed(note, "Let aside run it", "Let Aside run the TikTok account")).toBeNull();
    expect(acceptNamed(note, "Let aside run it", "Let Aside run it")).toBeNull();
    expect(acceptNamed(note, "Let aside run it", "Let Aside run it for Capture")).toBeNull();
    expect(acceptNamed(note, "Let aside run it", "Let Aside run the Instagram page for Capture and create the Instagram page for Capture")).toBeNull();
  });
});
