import type { Action } from "./model";
import type { GroupedActions } from "./group";

/**
 * Grouping, by meaning rather than by spelling.
 *
 * The local lens (group.ts) folds the list by shared words, which is instant
 * and free and cannot see a subject. A board with "Fix heat map bug", "Add
 * shortened commands for capture" and "Identify and prototype new
 * gamification ideas" shares no vocabulary at all, so the lens reported that
 * no two actions share a subject — while every one of them was about the
 * same app. That is the gap this pass fills.
 *
 * It is still a view: nothing is written to the board, no group exists as
 * data, and the flat list is untouched underneath. The model only decides
 * which rows sit together and what to call the pile.
 */

export type RawAiGroup = {
  label: string;
  ids: string[];
};

/** No more than this many groups, so the lens stays a lens and not an outline. */
const GROUP_CAP = 6;

/** A label long enough to name a subject, short enough to sit on one line. */
const LABEL_CAP = 28;

/**
 * Turn what the model said into groups over the real list.
 *
 * Everything is checked against the actions actually on screen: an id the
 * model invented names nothing, an id it used twice belongs to whichever
 * group claimed it first, and a group of one is not a group. Whatever
 * survives keeps board order, and everything unclaimed falls to `rest` —
 * so the lens can only ever reorder what is already there.
 */
export function mapAiGroups(
  actions: Action[],
  raw: RawAiGroup[]
): GroupedActions {
  const byId = new Map(actions.map((a) => [a.id, a]));
  const pos = new Map(actions.map((a, i) => [a.id, i]));
  const taken = new Set<string>();
  const groups: GroupedActions["groups"] = [];

  for (const g of raw) {
    if (groups.length >= GROUP_CAP) break;
    const label = (g?.label || "").replace(/\s+/g, " ").trim();
    if (!label) continue;
    const members: Action[] = [];
    for (const id of g?.ids || []) {
      const a = byId.get(id);
      if (!a || taken.has(id)) continue;
      taken.add(id);
      members.push(a);
    }
    /* A group of one is just a row with a heading over it. */
    if (members.length < 2) {
      for (const m of members) taken.delete(m.id);
      continue;
    }
    members.sort((x, y) => (pos.get(x.id) ?? 0) - (pos.get(y.id) ?? 0));
    groups.push({
      label:
        label.length > LABEL_CAP ? label.slice(0, LABEL_CAP).trim() + "…" : label,
      actions: members,
    });
  }

  /* Groups in board order of their newest member, matching the local lens so
     recency still reads top-down however the grouping was arrived at. */
  groups.sort(
    (a, b) => (pos.get(a.actions[0].id) ?? 0) - (pos.get(b.actions[0].id) ?? 0)
  );

  return {
    groups,
    rest: actions.filter((a) => !taken.has(a.id)),
  };
}
