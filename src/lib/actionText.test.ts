import { describe, expect, it } from "vitest";
import { acceptInContext, acceptNamed, acceptTasks, isRunOnAction, needsContext, placeInContext, pointsBack, splitActions } from "./actionText";
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

describe("Russian actions that lean on their capture", () => {
  const action = (text: string): SimpleSortItem => ({ kind: "action", text });
  it("are sent when they say его, их, туда or end on это", () => {
    expect(pointsBack(action("Отправить его Ане на проверку"))).toBe(true);
    expect(pointsBack(action("Перенести туда все заметки про ремонт"))).toBe(true);
    expect(pointsBack(action("Обсудить это"))).toBe(true);
    expect(pointsBack(action("Купить молоко"))).toBe(false);
  });
  it("accept a Russian rewrite in the capture's words, whatever the endings", () => {
    const note = "Написать пост про новую выставку и отправить его Ане на проверку";
    expect(acceptNamed(note, "Отправить его Ане на проверку", "Отправить пост о новой выставке Ане на проверку"))
      .toBe("Отправить пост о новой выставке Ане на проверку");
    expect(acceptNamed(note, "Отправить его Ане на проверку", "Отправить его Ане")).toBeNull();
    expect(acceptNamed(note, "Отправить его Ане на проверку", "Позвонить бабушке")).toBeNull();
  });
});


describe("several actions from one capture", () => {
  const note = "Post an article on X about running and another one about manifestation, using the Transurfing book as a reference";
  const items = ["Post an article on X about running", "Post another one about manifestation", "Use the Transurfing book as a reference"];

  it("is sent only with two or more new actions", () => {
    const action = (text: string, extra: Partial<SimpleSortItem> = {}): SimpleSortItem => ({ kind: "action", text, ...extra });
    expect(needsContext([action("A b"), action("C d")])).toBe(true);
    expect(needsContext([action("A b"), action("C d", { existingActionId: "a1" })])).toBe(false);
    expect(needsContext([action("A b"), { kind: "thought", text: "x", threads: [{ id: "t" }] }])).toBe(false);
  });

  it("accepts lines in the note's own words that each stand alone", () => {
    expect(acceptInContext(note, items, [
      { text: "Post an article on X about running", from: [1] },
      { text: "post an article on X about manifestation using the Transurfing book.", from: [2, 3] },
    ])).toEqual([
      { text: "Post an article on X about running", from: [0] },
      { text: "Post an article on X about manifestation using the Transurfing book", from: [1, 2] },
    ]);
  });

  it("refuses invented words, more lines than before, long lines, or losing most of the list", () => {
    expect(acceptInContext(note, items, [{ text: "Post a thread on Instagram about running", from: [1] }])).toBeNull();
    expect(acceptInContext(note, items.slice(0, 2), [
      { text: "Post about running", from: [1] }, { text: "Post about manifestation", from: [2] }, { text: "Post on X", from: [1] },
    ])).toBeNull();
    expect(acceptInContext(note, items, [{ text: note, from: [1, 2, 3] }])).toBeNull();
    expect(acceptInContext(note, items, [{ text: "Post an article on X about running", from: [1] }])).toBeNull();
    expect(acceptInContext(note, items, [{ text: "Post an article on X about running", from: [7] }])).toBeNull();
  });

  it("refuses an answer that quietly loses an item, but takes one it names as dropped", () => {
    const two = ["Create video of Wien's recent project", "Create video introducing Startup Foundation"];
    const wien = "Create video of Wien's recent project and also create a video for introducing Startup Foundation";
    expect(acceptInContext(wien, two, [{ text: "Create video introducing Startup Foundation", from: [2] }])).toBeNull();
    expect(acceptInContext("Publish it. Let's find.", ["Publish the posts", "Find the third thing"],
      [{ text: "Publish the posts", from: [1] }], [2])).toEqual([{ text: "Publish the posts", from: [0] }]);
  });

  it("allows a spelling fix and a possessive of the note's own words", () => {
    expect(acceptInContext("Write a post about Intetion on X and use the Transurfing book", ["Write a post about Intetion on X", "Use the Transurfing book"],
      [{ text: "Write a post about Intention on X using the Transurfing book", from: [1, 2] }]))
      .toEqual([{ text: "Write a post about Intention on X using the Transurfing book", from: [0, 1] }]);
    expect(acceptInContext("Post for TechTutor on Facebook and record student programs", ["Post on Facebook", "Record student programs"],
      [{ text: "Post on TechTutor's Facebook", from: [1] }, { text: "Record student programs", from: [2] }])).not.toBeNull();
  });

  it("puts the rewritten actions where the first stood, with their due dates", () => {
    const thought: SimpleSortItem = { kind: "thought", text: "Context.", threads: [{ id: "t" }] };
    const repeat: SimpleSortItem = { kind: "action", text: "Email Mia", existingActionId: "a1" };
    const first: SimpleSortItem = { kind: "action", text: "Post about running", due: "2026-10-16" };
    const second: SimpleSortItem = { kind: "action", text: "Post about manifestation" };
    expect(placeInContext([thought, first, repeat, second], [
      { text: "Post on X about running", from: [0] },
      { text: "Post on X about manifestation", from: [1] },
    ])).toEqual([
      thought,
      { kind: "action", text: "Post on X about running", due: "2026-10-16" },
      { kind: "action", text: "Post on X about manifestation" },
      repeat,
    ]);
  });
});
