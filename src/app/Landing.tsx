import Link from "next/link";
import { PLAYGROUND } from "@/lib/playground";

/** Where "open the app" points: the playground serves the board at /app so
    this page can hold the front door; a personal instance keeps it at /. */
const APP = PLAYGROUND ? "/app" : "/";

/*
 * The public page is allowed to be strange, because the app is not.
 *
 * Everything the app does quietly — learning from corrections, fading what
 * stopped mattering, asking whether a two-month-old intention is still
 * yours — gets explained once, here, so it never has to be explained
 * inside the product. That is the whole trade: the landing page carries the
 * weirdness so the board can stay empty.
 */

/* Run against the live sorter eight times while writing this page: one
   action and one thread, every time. The wording and the thread's name
   vary between runs, so neither is quoted as a promise. An earlier
   candidate — two tasks, two deadlines — was dropped because a capture
   carries a single due date, and the demo would have shipped a visible
   bug. */
const DEMO_IN =
  "uh fix the signup bug before friday and i keep going back and forth on usage based pricing vs seats";

const DEMO_OUT = [
  {
    kind: "Action",
    text: "Fix the signup bug before Friday",
    note: "closes, and fades if it stops mattering",
    /* The same marks the board uses: an empty box for a thing to close,
       stacked layers for a thing that grows. Recognition does the work a
       paragraph of explanation was doing. */
    mark: (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    kind: "Thread",
    text: "Pricing model decision",
    note: "keeps, and the summary stays current",
    mark: (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2 5.5 8 2.5l6 3-6 3-6-3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="m2 10.5 6 3 6-3" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
  },
];

const kinds = [
  {
    name: "Actions",
    label: "Mayflies",
    copy: "They exist to be closed. Each one gets a shelf life, and if it stops mattering it fades on its own. The list keeps itself honest.",
  },
  {
    name: "Threads",
    label: "Sediment",
    copy: "An idea rarely arrives whole. Each fragment adds a layer, and the thread keeps a current account of where the thinking stands.",
  },
  {
    name: "Intentions",
    label: "Standing decisions",
    copy: "Not goals. No checkbox, no due date — a state you are choosing to inhabit. Every couple of months it asks whether you still mean it.",
  },
];

const hidden = [
  "It learns when you correct it. Undo a capture and it asks what it should have been; answer once and the sorter carries that.",
  "It proposes only when there is a decision. No graph of what it knows, no dashboard of what it noticed.",
  "It shows its working where you would look for it, and nowhere else — the record, and the file you export.",
];

const personas = [
  "Founders whose day is a stream of half-thoughts",
  "Developers who spot bugs while fixing other bugs",
  "Anyone tired of choosing folders and tags",
  "People who want speed, clarity, and a short list",
  "People with four hundred notes and twelve they trust",
]

const rejects = [
  "A dashboard",
  "A folder system",
  "A graph to stare at",
  "A meeting notetaker",
  "A streak machine",
  "An AI companion that talks forever",
];

export function Landing() {
  return (
    <main className="capture-root site-page">
      <div className="capture-wrap site-wrap">
        <header className="capture-head site-head">
          <Link className="capture-mark funding-mark" href="/about">
            capture<span>.</span>
          </Link>
          <nav className="site-nav" aria-label="Capture links">
            <a href="https://github.com/glebbogachev00/capture">GitHub</a>
                        <Link href={APP}>Open app</Link>
          </nav>
        </header>

        <section className="site-hero">
          <p className="funding-kicker">Your notes app became a junk drawer</p>
          <h1>Thoughts that sort themselves.</h1>
          <p className="funding-lede site-lede">
            Built to catch and sort a thought in as few moves as it can get
            away with. Say it messy. It lands sorted.
          </p>
          <div className="site-actions">
            <Link className="capture-btn" href={APP}>
              Try Capture now
            </Link>
            <a
              className="ghost site-ghost"
              href="https://github.com/glebbogachev00/capture"
            >
              View source
            </a>
          </div>
          {PLAYGROUND && (
            <p className="site-cue">
              No account. The board you make stays in this browser.
            </p>
          )}
        </section>

        {/* The transformation is the product, so it is the first object on
            the page. Side by side, not stacked: the whole claim is that the
            left turns into the right, and a reader should see that before
            reading a word of it. */}
        <section className="site-card site-demo" aria-label="What it does">
          <div className="demo-split">
            <div className="demo-said">
              <p className="funding-card-label">You say</p>
              <p className="demo-in">“{DEMO_IN}”</p>
            </div>
            <div className="demo-turn" aria-hidden="true">
              <span>→</span>
            </div>
            <div className="demo-landed">
              <p className="funding-card-label">It lands as</p>
              <ul className="demo-out">
                {DEMO_OUT.map((row) => (
                  <li key={row.kind}>
                    <span className="demo-mark">{row.mark}</span>
                    <span className="demo-body">
                      <span className="demo-kind">{row.kind}</span>
                      <span className="demo-text">{row.text}</span>
                      <span className="demo-note">{row.note}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="demo-caption">
            One sentence, two different species of thing. You did not have to
            decide which, or tidy it first, or pick a folder.
          </p>
        </section>

        {/* One demo at a size worth watching, then the other two. Three
            equal tiles made every one of them too small to read the app in,
            which is the only thing they are for. */}
        <section className="demo-reel" aria-label="Watch it work">
          <figure className="site-card video-card reel-hero">
            <video
              controls
              muted
              playsInline
              preload="metadata"
              poster="/demos/two-places.jpg"
            >
              <source src="/demos/two-places.mp4" type="video/mp4" />
            </video>
            <figcaption>
              <strong>One sentence, two places</strong>
              <span>
                A task and a question in one breath. It files both, and you
                never chose which was which. 25 seconds, no sound.
              </span>
            </figcaption>
          </figure>

          <p className="reel-label">Two more</p>
          <div className="reel-more">
            {[
              {
                src: "/demos/it-learns.mp4",
                poster: "/demos/it-learns.jpg",
                title: "It got it wrong. You told it once.",
                note: "Undo asks what it should have been. The next one lands right, unasked.",
              },
              {
                src: "/demos/next-step.mp4",
                poster: "/demos/next-step.jpg",
                title: "It names the next move",
                note: "A thread reads its own evidence and offers the step. One tap makes it an action.",
              },
            ].map((v) => (
              <figure className="site-card video-card" key={v.src}>
                <video
                  controls
                  muted
                  playsInline
                  preload="metadata"
                  poster={v.poster}
                >
                  <source src={v.src} type="video/mp4" />
                </video>
                <figcaption>
                  <strong>{v.title}</strong>
                  <span>{v.note}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="site-card site-problem">
          <p className="funding-card-label">The point</p>
          <h2>It works best when you don&apos;t perform clarity.</h2>
          <p>
            Say it messy. Paste the fragment. Dictate the half-thought at a
            traffic light. Most tools want a clean prompt; this one is built
            for the sentence you actually produce. That is also why nothing
            here is called a note: notes are where thoughts go to rot. A
            thread holds fragments, each one already where it belongs.
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

        <section className="site-card site-quiet">
          <p className="funding-card-label">The sorting layer</p>
          <h2>The app is quiet because the sorting is not.</h2>
          <p>
            Capture is closer to a subconscious layer than a dashboard: it
            notices, files, fades and learns without narrating any of it.
          </p>
          <ul className="funding-list">
            {hidden.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="site-card site-split">
          <div>
            <p className="funding-card-label">Who this is for</p>
            <p className="site-condition">
              People whose thoughts arrive before they are ready to be
              organised.
            </p>
            <ul className="funding-list">
              {personas.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="funding-card-label">
              What Capture refuses to become
            </p>
            <ul className="funding-list">
              {rejects.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="site-card site-proof">
          <p className="funding-card-label">Yours</p>
          <h2>Your thinking stays yours.</h2>
          <p>
            It runs locally, on your own keys, and everything in it exports to
            a file you keep. The product can disappear. Your thinking does
            not. There are no customers here, only companions: people who use
            the thing, correct it, and keep it alive.
          </p>
          <div className="site-actions">
            <Link className="capture-btn" href={APP}>
              Try Capture now
            </Link>
            <a className="ghost site-ghost" href="https://ko-fi.com/banhmii">
              Become a companion
            </a>
          </div>
          <p className="site-cue">A one-off on Ko-fi. Nothing is locked.</p>
        </section>
      </div>
    </main>
  );
}
