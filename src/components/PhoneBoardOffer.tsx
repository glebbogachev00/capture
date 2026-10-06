"use client";

import { useEffect, useState } from "react";
import { bringInKeptBoard } from "@/hooks/useNativeShell";
import { callShell, inNativeShell } from "@/lib/nativeShell";

/** In the iPhone app, on Cloud or your own server: one offer to bring in the
 * board the free version kept on its way here (useNativeShell.ts). The
 * restore only adds, so bringing it in twice changes nothing. */
export function PhoneBoardOffer() {
  const [state, setState] = useState<"hidden" | "offer" | "busy" | "failed">("hidden");

  useEffect(() => {
    if (!inNativeShell()) return;
    let live = true;
    callShell<{ exists: boolean }>("hasStashedBoard").then(
      ({ exists }) => { if (live && exists) setState("offer"); },
      () => {},
    );
    return () => { live = false; };
  }, []);

  if (state === "hidden") return null;
  const bringIn = () => {
    setState("busy");
    bringInKeptBoard().then((done) => setState(done ? "hidden" : "failed"), () => setState("failed"));
  };
  return (
    <aside className="playground-note" aria-labelledby="phone-board-title">
      <div className="playground-note-copy">
        <strong id="phone-board-title">Bring in your board from the free version?</strong>
        <span>
          {state === "failed"
            ? "That didn't work, and your board here is unchanged. Try again."
            : "Everything you captured on this phone joins this board."}
        </span>
      </div>
      <div className="playground-note-actions">
        <button className="playground-note-action is-primary" onClick={bringIn} disabled={state === "busy"}>
          {state === "busy" ? "Bringing it in…" : "Bring it in"}
        </button>
        <button className="playground-note-action is-secondary" onClick={() => setState("hidden")}>
          Not now
        </button>
      </div>
    </aside>
  );
}
