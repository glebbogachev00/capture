import type { Action } from "./model";

/** Separate preserved-but-unclassified captures from actual actionable work. */
export function actionViews(actions: Action[]): {
  live: Action[];
  unsorted: Action[];
  faded: Action[];
} {
  return {
    live: actions.filter((action) => !action.done && !action.faded && !action.unsorted),
    unsorted: actions.filter((action) => !action.done && !action.faded && action.unsorted),
    faded: actions.filter((action) => action.faded && !action.done),
  };
}
