"use client";

import { useState } from "react";
import { ArrowRight, Layers, RotateCcw } from "lucide-react";
import styles from "./LandingThreadExample.module.css";

const captures = [
  { day: "Monday", text: "Maybe the workshop should start with people making something, not slides. Book the room on Friday." },
  { day: "Wednesday", text: "For that workshop, pairs could build a tiny game. They would have something to show each other." },
  { day: "Friday", text: "Workshop decision: start with the game in pairs, then explain the code they used." },
];
const summaries = [
  "Start the workshop with making rather than slides. The format is still open.",
  "Start by making a tiny game in pairs, with something to share. The explanation can follow the activity.",
  "Start with pairs building a tiny game. Then explain the code they used. The format has moved from an idea to a decision.",
];

/** An authored illustration, not a provider response or a customer transcript.
 * Deliberately user-paced: no timers, autoplay, or disappearing source text. */
export function LandingThreadExample() {
  const [step, setStep] = useState(0);
  return (
    <section className={`site-card ${styles.example}`} aria-labelledby="thread-example-title">
      <div className={styles.heading}>
        <div>
          <p className="funding-card-label">Example · three captures, one growing idea</p>
          <h2 id="thread-example-title">The next thought has somewhere to go.</h2>
        </div>
        <span className={styles.counter}>{step + 1} of 3</span>
      </div>
      <div className={styles.columns}>
        <div>
          <p className={styles.label}>You capture, over time</p>
          <ol className={styles.sources}>
            {captures.slice(0, step + 1).map((capture) => (
              <li key={capture.day} className={styles.arrival}>
                <span>{capture.day}</span>
                <p>{capture.text}</p>
              </li>
            ))}
          </ol>
        </div>
        <div className={styles.result} aria-live="polite" aria-atomic="true">
          <p className={styles.label}><Layers size={16} aria-hidden="true" /> Thread · Workshop format</p>
          <h3>Where this stands</h3>
          <p key={step} className={styles.arrival}>{summaries[step]}</p>
          <p className={styles.kept}>{step + 1} source {step === 0 ? "capture kept" : "captures kept"} alongside the summary.</p>
          <div className={styles.action}>
            <span className={styles.label}>Separate action</span>
            <p>Book the room on Friday</p>
            <small>You mark it done. Expiry is not completion.</small>
          </div>
        </div>
      </div>
      <div className={styles.footer}>
        <p>Related thoughts build on each other. The original captures stay in the Record.</p>
        <button type="button" className="ghost" onClick={() => setStep(step === 2 ? 0 : step + 1)}>
          {step === 2 ? <><RotateCcw size={16} aria-hidden="true" /> Replay example</> : <>Add {captures[step + 1].day}’s thought <ArrowRight size={16} aria-hidden="true" /></>}
        </button>
      </div>
      <p className={styles.disclaimer}>Illustrative example, not a live AI result. Advance at your own pace.</p>
    </section>
  );
}
