/**
 * Can this device reach the Capture that sorts its notes right now?
 *
 * A capture is saved on the device first and sorted by the server after. When
 * the server cannot be reached (a VPN that dropped without saying so, a hub
 * that is asleep, no signal), the sort request did not fail: it hung for most
 * of a minute, and was retried once. All that time the capture showed nowhere,
 * so it looked lost and people said it again.
 *
 * So a sort that has not answered in a few seconds asks the server a question
 * it answers instantly (/api/version: no board data, never cached, never
 * served by the offline cache). No answer means unreachable: the capture is
 * shown as saved and waiting, and is sorted when the server answers again.
 * Any answer at all, even an error, means the server is there and the sort is
 * simply slow, so it carries on.
 */

export const ASK_AFTER_MS = 6_000;
export const ANSWER_WITHIN_MS = 4_000;
export const RECHECK_EVERY_MS = 10_000;

type Request = (input: string, init?: RequestInit) => Promise<Response>;

/* Offline (no network at all) is not this: the app already keeps those
   captures in Unsorted, and the device itself says it is offline. This is the
   case where the network is fine and the server still does not answer. */
export class Reachability {
  private down = false;

  constructor(private request: Request) {}

  /** The server did not answer when last asked. */
  isDown() {
    return this.down;
  }

  /** Ask the server; true when it answered at all. */
  async check(): Promise<boolean> {
    try {
      await this.request("/api/version", { cache: "no-store", signal: AbortSignal.timeout(ANSWER_WITHIN_MS) });
      this.down = false;
      return true;
    } catch {
      this.down = true;
      return false;
    }
  }

  /** While a sort runs: if it has not answered after a few seconds and the
   * server does not answer either, `unreachable` runs once. Returns a stop. */
  watch(unreachable: () => void, after = ASK_AFTER_MS): () => void {
    let stopped = false;
    const timer = setTimeout(() => {
      void this.check().then((answered) => {
        if (!answered && !stopped) unreachable();
      });
    }, after);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }
}
