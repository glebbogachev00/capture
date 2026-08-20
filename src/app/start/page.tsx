import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "capture · get it running",
  description:
    "See capture actually working — three short recordings — and get your own copy running in about two minutes.",
};

/*
 * /about carries the argument; this page carries the proof and the steps.
 * The three videos are real recordings of the app driven end to end (made
 * with Retake against a clean board — re-recorded, not edited, when the
 * UI changes), so what a visitor watches is what they get.
 */

const DEMOS = [
  {
    file: "capture-two-places",
    title: "Say it messy",
    copy: "One run-on sentence goes in. It lands as an action with a deadline and a thread that keeps thinking — filed, worded, done.",
  },
  {
    file: "distill-messy",
    title: "Distill a tangle",
    copy: "Too knotted to capture? Talk it through. The engine asks what's missing, settles the thought, and saves it sharper than it arrived.",
  },
  {
    file: "mark-done",
    title: "Close it and move on",
    copy: "Actions exist to be closed. Tick one and it leaves the open list — the board stays small enough to trust.",
  },
];

const FEATURES = [
  ["One box in", "Speak or type a half-formed thought. No folders, no tags, no choosing where it goes before the sentence is finished."],
  ["Three places it lands", "Actions close, threads accumulate, intentions stand — a model files it and cleans up the wording."],
  ["Shelf life", "Every action fades when it stops mattering. The list keeps itself honest."],
  ["Distill", "A conversation for thoughts that don't fit in a sentence — one question at a time until the shape emerges."],
  ["Local-first", "Your board lives in your browser, your keys on your machine. No account, no cloud, no subscription."],
  ["Your phone too", "One command pairs your phone and Mac over Tailscale — same app, same voice, any network."],
];

export default function StartPage() {
  return (
    <main className="capture-root site-page">
      <div className="capture-wrap site-wrap">
        <header className="site-head">
          <Link className="capture-mark funding-mark" href="/about">
            capture<span>.</span>
          </Link>
          <nav className="site-nav" aria-label="Capture links">
            <Link href="/about">About</Link>
            <a href="https://github.com/glebbogachev00/capture">GitHub</a>
            <Link href="/">Open app</Link>
          </nav>
        </header>

        <section className="site-hero">
          <p className="funding-kicker">See it, then run it</p>
          <h1>Two minutes of watching, two minutes of setup.</h1>
          <p className="funding-lede site-lede">
            These are real recordings of capture doing its job — not mockups.
            If the shape fits how you think, your own copy is a clone and one
            model key away.
          </p>
        </section>

        <section aria-label="Demo videos" className="start-demos">
          {DEMOS.map((d) => (
            <figure key={d.file} className="site-card start-demo">
              <video
                src={`/demos/${d.file}.mp4`}
                poster={`/demos/${d.file}.jpg`}
                controls
                muted
                playsInline
                preload="none"
              />
              <figcaption>
                <p className="funding-card-label">{d.title}</p>
                <p>{d.copy}</p>
              </figcaption>
            </figure>
          ))}
        </section>

        <section aria-label="What you get" className="start-features">
          <h2>What you get</h2>
          <div className="site-kind-grid">
            {FEATURES.map(([name, copy]) => (
              <div key={name} className="site-card">
                <p className="funding-card-label">{name}</p>
                <p>{copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-label="Setup" className="site-card start-setup">
          <p className="funding-card-label">Get it running</p>
          <p>Needs Node 20 or newer. Two minutes, one key:</p>
          <pre>
            <code>{`git clone https://github.com/glebbogachev00/capture.git
cd capture
npm install
cp .env.example .env.local
# add at least one model key to .env.local, then:
npm run dev`}</code>
          </pre>
          <p>
            Open <code>http://localhost:3000</code> and say something messy.
            Voice, your phone, and always-on hosting are a few steps more —{" "}
            <a href="https://github.com/glebbogachev00/capture/blob/main/SETUP.md">
              SETUP.md
            </a>{" "}
            walks through all of it.
          </p>
        </section>

        <footer className="start-foot">
          <p>
            The recordings above were made with{" "}
            <a href="https://github.com/glebbogachev00/retake">Retake</a> —
            demos as code, re-run instead of re-recorded when the UI changes.
          </p>
        </footer>
      </div>
    </main>
  );
}
