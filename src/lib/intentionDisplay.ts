import type { Intention } from "./model";

/** Current list positions, separate from legacy stored creation numbers. */
export function intentionDisplayNumbers(intentions: readonly Intention[]): Map<string, number> {
  return new Map(intentions.map((intention, index) => [intention.id, intentions.length - index]));
}
