/**
 * Should a running app reload itself onto a newer build?
 *
 * The decision is separated from the component that acts on it because the
 * decision is where the mistakes live. Reloading is destructive — it can eat
 * a half-typed thought, and a rule that disagrees with itself reloads
 * forever — so each condition is stated once, here, where it can be tested.
 *
 * See FreshBuild.tsx for why this exists at all.
 */

export type Conditions = {
  /** The build this bundle was compiled as. */
  mine: string | undefined;
  /** The build the server says it is serving. */
  served: string | undefined;
  /** Is the app actually in front of someone? */
  visible: boolean;
  /** Is there text in the composer that a reload would throw away? */
  composerBusy: boolean;
  /** The build we have already reloaded for, if any. */
  reloadedFor: string | null;
};

export type Decision =
  /** Reload, and remember this build so it can never happen twice. */
  | { reload: true; remember: string }
  /** Do nothing, for a reason worth naming in a test. */
  | { reload: false; because: Reason };

export type Reason =
  | "unknown-build"
  | "already-current"
  | "not-visible"
  | "already-reloaded"
  | "composer-busy";

export function decide(c: Conditions): Decision {
  /* Nothing to compare: a build without a name, or a server that would not
     say. Never guess — guessing here means reloading at random. */
  if (!c.mine || !c.served) return { reload: false, because: "unknown-build" };

  if (c.mine === c.served) return { reload: false, because: "already-current" };

  /* Reloading a backgrounded app is pointless and burns the one reload we
     allow per build. */
  if (!c.visible) return { reload: false, because: "not-visible" };

  /* The loop guard, and the reason it comes before the composer check: a
     build we have already reloaded for is settled, whatever else is true. */
  if (c.reloadedFor === c.served)
    return { reload: false, because: "already-reloaded" };

  /* Losing a thought is worse than running yesterday's build for another
     minute. This deliberately does NOT mark the build as handled, so the
     reload still happens once the composer is clear. */
  if (c.composerBusy) return { reload: false, because: "composer-busy" };

  return { reload: true, remember: c.served };
}
