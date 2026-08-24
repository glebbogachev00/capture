"use client";

import { useEffect, useState } from "react";
import { PLAYGROUND } from "@/lib/playground";
import { TOUR_STEPS, tourStepDone, type TourCtx } from "@/lib/tour";

/**
 * The tour card: one quiet suggestion above the box, playground only.
 *
 * Nothing dims, nothing blocks, and every step has two exits — skip this
 * step, or leave the whole tour. Progress persists so a reload resumes
 * where the board actually is. Once finished or skipped it never returns;
 * a board that already has captures on first sight never starts it (that
 * person needs no walkthrough).
 */
const KEY = "capture:tour:v1";

type Saved = { step: number } | "done";

const read = (): Saved | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return "done";
  }
};
const save = (v: Saved) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private mode: the tour just restarts next visit */
  }
};

export function Tour({
  ctx,
  onPrefill,
}: {
  ctx: TourCtx;
  onPrefill: (text: string) => void;
}) {
  /* null = not mounted yet; -1 = never show. */
  const [step, setStep] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const saved = read();
    if (saved === "done") return setStep(-1);
    if (saved) return setStep(saved.step);
    /* First sight. A board with history is not a first-timer's board. */
    setStep(ctx.captures === 0 ? 0 : -1);
    if (ctx.captures !== 0) save("done");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Watch the board, not the clicks. */
  useEffect(() => {
    if (step === null || step < 0 || step >= TOUR_STEPS.length) return;
    if (tourStepDone(step, ctx)) {
      const next = step + 1;
      setStep(next);
      if (next >= TOUR_STEPS.length) setClosing(true);
      save(next >= TOUR_STEPS.length ? "done" : { step: next });
    }
  }, [step, ctx]);

  if (!PLAYGROUND || step === null || step < 0) return null;

  if (step >= TOUR_STEPS.length) {
    if (!closing) return null;
    return (
      <div className="tour-card">
        <p className="tour-step">That’s the whole app</p>
        <p className="tour-body">
          Actions fade, threads grow, and it learns when you correct it.
          It’s yours now — this board lives in your browser.
        </p>
        <div className="tour-row">
          <button className="tour-skip" onClick={() => setClosing(false)}>
            Finish
          </button>
        </div>
      </div>
    );
  }

  const s = TOUR_STEPS[step];
  const skipStep = () => {
    const next = step + 1;
    setStep(next);
    if (next >= TOUR_STEPS.length) {
      setClosing(true);
      save("done");
    } else save({ step: next });
  };
  const leave = () => {
    setStep(-1);
    save("done");
  };

  return (
    <div className="tour-card">
      <p className="tour-step">
        Tour · {step + 1} of {TOUR_STEPS.length}
      </p>
      <p className="tour-title">{s.title}</p>
      <p className="tour-body">{s.body}</p>
      {s.prefill && (
        <button className="tour-prefill" onClick={() => onPrefill(s.prefill!)}>
          “{s.prefill}”
        </button>
      )}
      <div className="tour-row">
        <button className="tour-skip" onClick={skipStep}>
          Skip this step
        </button>
        <button className="tour-skip tour-leave" onClick={leave}>
          Leave the tour
        </button>
      </div>
    </div>
  );
}
