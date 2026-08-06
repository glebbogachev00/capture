import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "capture · fast notes without the junk drawer",
  description:
    "Capture keeps the speed of quick notes without letting thoughts become a junk drawer.",
};

const kinds = [
  {
    name: "Actions",
    label: "Close it",
    copy: "A task should not rot in an inbox. Capture gives it a shape, a shelf life, and a clear way to finish.",
  },
  {
    name: "Threads",
    label: "Build it",
    copy: "An idea rarely arrives whole. Capture adds each fragment to the right thread and keeps the gist visible.",
  },
  {
    name: "Intentions",
    label: "Inhabit it",
    copy: "Some notes are not tasks. They are declared states. Capture keeps them present without turning them into checkboxes.",
  },
];

const uses = [
  "Save the thought before it disappears.",
  "Turn a loose task into something that can close.",
  "Add fragments to ideas without building folders first.",
  "Use voice without creating a graveyard of recordings.",
];

const principles = [
  "Capture first. Sort after.",
  "One thought lands as one useful shape.",
  "Search should understand gist, not only exact words.",
  "Your thinking must stay portable.",
];

const rejects = [
  "A meeting notetaker",
  "A second-brain dashboard",
  "A tags-first PKM system",
  "A transcript graveyard",
];

export default function AboutPage() {
  return (
    <main className="capture-root site-page">
      <div className="capture-wrap site-wrap">
        <header className="capture-head site-head">
          <Link className="capture-mark funding-mark" href="/about">
            capture<span>.</span>
          </Link>
          <nav className="site-nav" aria-label="Capture links">
            <Link href="/voice">Voice</Link>
            <a href="https://github.com/glebbogachev00/capture">GitHub</a>
            <Link href="/funding">Funding</Link>
            <Link href="/">Open app</Link>
          </nav>
        </header>

        <section className="site-hero">
          <p className="funding-kicker">Fast notes without the junk drawer</p>
          <h1>Capture the thought. Do not build the pile.</h1>
          <p className="funding-lede site-lede">
            Capture keeps the speed of Apple Notes without letting your thoughts
            become write-only memory. Say it, paste it, or dictate it. Capture
            sorts it into an action, a thread, or an intention.
          </p>
          <div className="site-actions">
            <Link className="capture-btn" href="/">
              Open app
            </Link>
            <a
              className="ghost site-ghost"
              href="https://github.com/glebbogachev00/capture"
            >
              View source
            </a>
          </div>
        </section>

        <section className="site-card site-problem">
          <p className="funding-card-label">The problem</p>
          <p>
            The app that is easy to write into becomes hard to find things in.
            The app that is good at finding things is too heavy to write into.
            Capture keeps the fast door and adds the sorting layer.
          </p>
        </section>

        <section className="site-kind-grid" aria-label="The three kinds">
          {kinds.map((kind) => (
            <article className="site-card kind-card" key={kind.name}>
              <p className="funding-card-label">{kind.label}</p>
              <h2>{kind.name}</h2>
              <p>{kind.copy}</p>
            </article>
          ))}
        </section>

        <section className="site-card site-split">
          <div>
            <p className="funding-card-label">Use it when you need to</p>
            <ul className="funding-list">
              {uses.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="funding-card-label">Product rules</p>
            <ul className="funding-list">
              {principles.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="site-card site-split">
          <div>
            <p className="funding-card-label">What Capture is not</p>
            <ul className="funding-list">
              {rejects.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="funding-card-label">The operating loop</p>
            <p>
              Fast input first. Shape second. Review only when the thought has
              enough weight to deserve it.
            </p>
          </div>
        </section>

        <section className="site-card site-proof">
          <p className="funding-card-label">The model</p>
          <h2>The full thinking system stays free.</h2>
          <p>
            Run it yourself with your own keys. Pay only if you want managed
            sync, backup, AI, publishing, and hosting.
          </p>
          <Link className="ghost site-ghost" href="/funding">
            See the funding model
          </Link>
        </section>
      </div>
    </main>
  );
}
