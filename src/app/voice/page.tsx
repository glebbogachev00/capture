import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Voice guide · capture",
  description:
    "A simple guide to using voice with Capture without creating a transcript graveyard.",
};

const options = [
  {
    name: "Built-in dictation",
    label: "best first setup",
    copy: "Use the mic already on your phone or computer. It is free, quick, and good enough to catch most thoughts.",
  },
  {
    name: "Wispr Flow",
    label: "best external layer",
    copy: "Use it when you want cleaner voice text across Mac, Windows, iPhone, Android, and other apps.",
  },
  {
    name: "Capture mic",
    label: "inside the app",
    copy: "Use the app mic when your browser supports speech recognition. It drops spoken text into Capture or Distill.",
  },
];

const operatingModes = [
  "Quick capture: speak one thought, then tap Capture.",
  "Distill: talk through a thought before it is clear.",
  "External dictation: put the cursor in Capture, speak, then submit.",
  "Power setup: use Wispr Flow for clean text, then let Capture sort it.",
];

const rules = [
  "Do not make Capture depend on one dictation provider.",
  "Keep the text box open to any tool that can type into it.",
  "Recommend the lowest-friction voice layer for each person.",
  "Let Capture do the filing after the words land.",
];

export default function VoicePage() {
  return (
    <main className="capture-root site-page">
      <div className="capture-wrap site-wrap">
        <header className="capture-head site-head">
          <Link className="capture-mark funding-mark" href="/about">
            capture<span>.</span>
          </Link>
          <nav className="site-nav" aria-label="Capture links">
            <Link href="/about">About</Link>
            <Link href="/funding">Funding</Link>
            <a href="https://github.com/glebbogachev00/capture">GitHub</a>
            <Link href="/">Open app</Link>
          </nav>
        </header>

        <section className="site-hero voice-hero">
          <p className="funding-kicker">Voice setup</p>
          <h1>Voice should not become another pile.</h1>
          <p className="funding-lede site-lede">
            Recording is easy. Reuse is the hard part. Capture is the place the
            spoken thought lands, gets cleaned up, and files itself.
          </p>
        </section>

        <section className="site-card site-problem">
          <p className="funding-card-label">The simple rule</p>
          <p>
            Dictation gets words down. Capture decides what the words are for.
          </p>
        </section>

        <section className="site-kind-grid" aria-label="Voice options">
          {options.map((option) => (
            <article className="site-card kind-card" key={option.name}>
              <p className="funding-card-label">{option.label}</p>
              <h2>{option.name}</h2>
              <p>{option.copy}</p>
            </article>
          ))}
        </section>

        <section className="site-card site-split">
          <div>
            <p className="funding-card-label">Operating modes</p>
            <ul className="funding-list">
              {operatingModes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="funding-card-label">Design rules</p>
            <ul className="funding-list">
              {rules.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="site-card site-proof">
          <p className="funding-card-label">Recommended path</p>
          <h2>Start with the built-in mic. Add Wispr Flow if voice becomes your main input.</h2>
          <p>
            The app stays independent from any one dictation tool. If a tool can
            put text into the box, Capture can use it.
          </p>
          <Link className="ghost site-ghost" href="/about">
            Back to the overview
          </Link>
        </section>
      </div>
    </main>
  );
}
