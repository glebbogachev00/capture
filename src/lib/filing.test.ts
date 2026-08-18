import { describe, expect, it } from "vitest";
import type { Board, Frag, Thread } from "./model";
import { EMPTY } from "./model";
import { scanBoard } from "./organize";

/*
 * Filing claims — "this note is sitting in the wrong thread".
 *
 * Every case here is drawn from a real board where the scan embarrassed
 * itself: it offered to move a note about a duplication bug into a thread
 * of bank account numbers, because both texts contained the words "three"
 * and "items". The lesson is that overlap length is the wrong test. Two
 * words can be decisive ("espresso machine") or worthless ("three items");
 * what separates them is whether the board says them everywhere.
 */

const NOW = 10_000;

const frag = (id: string, text: string): Frag => ({ id, at: 100, text });

const thread = (
  id: string,
  name: string,
  frags: Frag[],
  summary = ""
): Thread => ({ id, name, summary, frags });

const board = (threads: Thread[]): Board => ({ ...EMPTY, threads });

const moves = (b: Board) =>
  scanBoard(b, [], NOW).filter((p) => p.kind === "move_fragment");

describe("filing — a shared word only counts when it is rare", () => {
  it("does not file a bug note with bank details over 'three' and 'items'", () => {
    /* The real one. "three" and "items" are scattered across the board, so
       the overlap says nothing about where the note belongs. */
    const b = board([
      thread("bugs", "Bugs, Issues and Additions", [
        frag("f1", "After using extra approve, it adds three copies of items within the same thread"),
        frag("f2", "The share sheet opens behind the keyboard on iOS"),
      ]),
      thread("banking", "Banking Info", [
        frag("f3", "TRAN KIM CHI MOMO 0946950600 TECHCOM 19072233710018"),
      ]),
      thread("shop", "Shopping", [frag("f4", "three items left on the list")]),
      thread("build", "Building", [frag("f5", "ship three items this week")]),
      thread("ads", "Ad & Campaign Creation", [
        frag("f6", "the carousel shows items three at a time"),
      ]),
    ]);
    expect(moves(b)).toHaveLength(0);
  });

  it("does not file a spec with a mindset thread over 'step' and 'choose'", () => {
    const b = board([
      thread("building", "Building", [
        frag("f1", "Here's the clean step-by-step requirements for app two, call it Style Kit"),
        frag("f2", "Ship the importer before the editor"),
      ]),
      thread("rc", "Reality Creation Game", [
        frag("f3", "Break reality creation into a step-by-step practice, choose the state first"),
        frag("f4", "Purified intent means acting without pushing for the end result"),
      ]),
      thread("tt", "TechTutor", [frag("f5", "step through the lesson and choose a track")]),
      thread("ovid", "Ovid", [frag("f6", "choose one step at a time")]),
    ]);
    expect(moves(b)).toHaveLength(0);
  });

  it("still files on a rare two-word overlap", () => {
    /* "espresso machine" is two words, the same length as "three items",
       and belongs — because almost nothing else on the board says it. */
    const b = board([
      thread("career", "Career", [
        frag("f1", "Espresso machine grinder calibration keeps drifting"),
        frag("f2", "Portfolio review went well"),
      ]),
      thread("equip", "Kitchen Equipment", [
        frag("f3", "Espresso machine settings overview"),
      ]),
    ]);
    const out = moves(b);
    expect(out).toHaveLength(1);
    expect(out[0].sourceFragId).toBe("f1");
    expect(out[0].targetId).toBe("equip");
  });

  it("never takes its evidence from Capture's own summary", () => {
    /* The summary is generated prose ABOUT the thread, so it is dense with
       connective vocabulary. Matching against it let the app cite itself:
       "Banking Info" earned a filing claim through the word "three" in a
       sentence Capture had written, not in anything the person put there. */
    const b = board([
      thread("src", "Notes", [
        frag("f1", "The alignment jig needs recalibrating"),
        frag("f2", "Unrelated second note so this is not a lone fragment"),
      ]),
      thread(
        "dst",
        "Banking Info",
        [frag("f3", "TPBANK 5676 7666 888")],
        "Where this stands: the entry records the alignment jig needs recalibrating"
      ),
    ]);
    expect(moves(b)).toHaveLength(0);
  });

  it("quotes the destination, not the note being moved", () => {
    const b = board([
      thread("career", "Career", [
        frag("f1", "Espresso machine grinder calibration keeps drifting badly"),
        frag("f2", "Portfolio review went well"),
      ]),
      thread("equip", "Kitchen Equipment", [
        frag("f3", "Espresso machine settings overview"),
      ]),
    ]);
    const reason = moves(b)[0].reason;
    /* The claim is about what is already over there, so the quote has to be
       findable over there — quoting the note's own wording turned a
       two-word overlap into a sentence the thread had never said. */
    const quoted = reason.match(/"([^"]+)"/)?.[1] ?? "";
    expect(quoted).toBeTruthy();
    expect("Kitchen Equipment Espresso machine settings overview".toLowerCase())
      .toContain(quoted.toLowerCase());
  });
});
