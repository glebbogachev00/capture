import Link from "next/link";
import { PLAYGROUND } from "@/lib/playground";

/** Where "open the app" points: the playground serves the board at /app so
    this page can hold the front door; a personal instance keeps it at /. */
const APP = PLAYGROUND ? "/app" : "/";

/* The sponsor page is still unfinished and carries a different nav, so the
   landing page does not send anyone to it yet. Flip to true to bring the
   button and its line back — nothing else has to change. */
const SHOW_SPONSOR = false;

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
    copy: "They exist to be closed. Each one gets a shelf life, and fades on its own if it stops mattering.",
  },
  {
    name: "Threads",
    label: "Sediment",
    copy: "An idea rarely arrives whole. Each fragment adds a layer, and the summary stays current.",
  },
  {
    name: "Intentions",
    label: "Standing decisions",
    copy: "Not goals. No checkbox, no due date. Every couple of months it asks whether you still mean it.",
  },
];

const hidden = [
  "It learns when you correct it. Answer once and the sorter carries it.",
  "It proposes only when there is a decision. No graph of what it knows, no dashboard of what it noticed.",
  "It shows its working in the record and in the file you export.",
];

const personas = [
  "You notice a bug while fixing a different one",
  "A decision keeps coming back and never gets made",
  "You dictate on a walk and never listen back",
  "You have hundreds of notes and trust twelve",
]

const rejects = [
  "A dashboard",
  "A folder system",
  "A graph to stare at",
  "A streak machine",
  "A chatbot that talks forever",
];

export function Landing() {
  /* The posed "you say / it lands as" card. In the wide layouts the hero's
     second column belongs to the recording, and this drops to the slot the
     recording used to hold, so the page keeps both and repeats neither. */
  const demoCard = (
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
  );
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
            away with. Say it messy: the task lands on your list, the
            question becomes a thread you keep.
          </p>
          <div className="site-actions">
            <Link className="capture-btn" href={APP}>
              Sort a thought
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
        {/* The recording, in the same card every other block sits in, and
            with no caption under it: the caption repeated the headline.
            It does not autoplay — the take opens on a title card, which as
            a still is an empty rectangle, so the poster is the payoff
            frame instead. */}
        <div className="site-card site-demo hero-clip">
          <video
            controls
            muted
            playsInline
            preload="metadata"
            poster="/demos/two-places.jpg"
            width={1440}
            height={1000}
          >
            <source src="/demos/two-places.mp4" type="video/mp4" />
          </video>
        </div>

        {/* One demo at a size worth watching, then the other two. Three
            equal tiles made every one of them too small to read the app in,
            which is the only thing they are for. */}
        <section className="demo-reel" aria-label="Watch it work">
          {demoCard}

          <details className="reel-fold">
            <summary>See two more examples</summary>
            <div className="reel-more">
              {[
                {
                  src: "/demos/it-learns.mp4",
                  poster: "/demos/it-learns.jpg",
                  w: 1440,
                  h: 1230,
                  title: "It got it wrong. You told it once.",
                  note: "Undo asks what it should have been. The next one lands right, unasked.",
                },
                {
                  src: "/demos/next-step.mp4",
                  poster: "/demos/next-step.jpg",
                  w: 1440,
                  h: 1230,
                  title: "It names the next move",
                  note: "A thread offers the step. One tap makes it an action.",
                },
              ].map((v) => (
                <figure className="site-card video-card" key={v.src}>
                  <video
                    controls
                    muted
                    playsInline
                    preload="metadata"
                    poster={v.poster}
                    width={v.w}
                    height={v.h}
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
          </details>
        </section>

        {/* The only proof on the page about a person rather than the
            software. It opens by naming the convention it is breaking,
            because a maker's note dressed up as a stranger's review would
            be worth less than nothing. The face goes first, so a reader
            knows a person is talking before reading a word of it. */}
        <section className="site-card site-note" aria-label="From the maker">
          <div className="note-who">
            {/* Plain img, not next/image: 128px of JPEG that never changes
                and is decorative, so an optimiser would only add a round
                trip and a transformation bill. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/gleb.jpg" alt="" width={44} height={44} />
            <span>
              <span className="funding-card-label">
                From the person who made it
              </span>
              <span className="note-name">Gleb, who uses it most</span>
            </span>
          </div>

          <h2>This is where the reviews usually go.</h2>
          <p>
            I do not have any yet, so here is the honest version. I built
            it for myself at the end of July, and I have used it every day
            since.
          </p>

          {/* Four links, because a link is checkable and a sentence is
              not. The label is first person and says only what is true: he
              used it on these. It does not claim they run on Capture, and
              there are no logos — a stranger can click, or not. */}
          <div className="note-rail">
            <p className="funding-card-label">What I have used it on</p>
            <ul>
              {[
                {
                  name: "Capture",
                  gloss: "this app, in the open",
                  href: "https://github.com/glebbogachev00/capture",
                },
                {
                  name: "Retake",
                  gloss: "recorded the videos above",
                  href: "https://github.com/glebbogachev00/retake",
                },
                {
                  name: "TechBash",
                  gloss: "a coding school for kids",
                  href: "https://bash.techtutor.academy/preview",
                },
                {
                  name: "AvexJets",
                  gloss: "a charter booking flow",
                  href: "https://www.avex-jets.com/",
                },
              ].map((x) => (
                <li key={x.name}>
                  <a href={x.href} target="_blank" rel="noreferrer">
                    {x.name}
                  </a>
                  <span>{x.gloss}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* The day, in the three moments that matter. Prose made a
              reader work for what a glance can give them. */}
          <dl className="note-beats">
            <div>
              <dt>On a walk</dt>
              <dd>Ideas arrive when I am out. I say them into the box unformed.</dd>
            </div>
            <div>
              <dt>Back home</dt>
              <dd>
                The tasks are on a list I actually close. The thinking has
                gathered into threads.
              </dd>
            </div>
            <div>
              <dt>To an agent</dt>
              <dd>
                A thread copies out in one tap, straight into Claude or
                whatever you build with. What is readable for me turns out
                to be readable for an agent.
              </dd>
            </div>
          </dl>

          <p className="site-note-claim">
            It cleared my head, and a clear head builds faster.
          </p>
        </section>

        <section className="site-card site-problem">
          <p className="funding-card-label">The point</p>
          <h2>It works best when you don&apos;t perform clarity.</h2>
          <p>
            Most tools want a clean prompt. This one is built for the
            sentence you actually produce. Nothing here is called a note.
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
            It notices, files, fades and learns without narrating any of it.
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
              filed.
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
            It runs locally, on your own keys, and exports to a file you
            keep. The product can disappear. Your thinking does not.
          </p>
          <div className="site-actions">
            <Link className="capture-btn" href={APP}>
              Sort a thought
            </Link>
            {SHOW_SPONSOR && (
              <Link className="ghost site-ghost" href="/sponsor">
                Sponsor Capture
              </Link>
            )}
          </div>
          {SHOW_SPONSOR && (
            <p className="site-cue">
              Sponsor once or regularly. The full thinking system stays free.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
