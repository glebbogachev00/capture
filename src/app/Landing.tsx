import Link from "next/link";
import { PLAYGROUND, TRIAL_LIMIT } from "@/lib/playground";
import { siteHome, websiteSchema } from "@/lib/seo";
import { LandingDemo } from "@/components/LandingDemo";
import { SiteNav } from "@/components/SiteNav";

/** Where "open the app" points: the playground serves the board at /app so
    this page can hold the front door; a personal instance keeps it at /. */
const APP = PLAYGROUND ? "/app" : "/";
const HOME = siteHome(PLAYGROUND);

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


/** A page-level signpost. Every heading on this page lived inside a card,
    all at one size, so the page had no sections — just a stack of boxes a
    reader had to work out for themselves. This sits on the background,
    above the cards, and says what the next stretch is for.

    `id` is a hook for ordering, not something anyone sees: numbering the
    sections turned a page into a manual, and the titles already say where
    you are. */
function Movement({
  id,
  title,
  gloss,
}: {
  id: string;
  title: string;
  gloss?: string;
}) {
  return (
    <div className="movement" data-move={id} id={id}>
      <h2>{title}</h2>
      {gloss && <p>{gloss}</p>}
    </div>
  );
}

export function Landing() {
  const schema = websiteSchema(PLAYGROUND);
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
      {schema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      )}
      <div className="capture-wrap site-wrap">
        <header className="capture-head site-head">
          <Link className="capture-mark funding-mark" href={HOME}>
            capture<span>.</span>
          </Link>
          <SiteNav current="about" homeHref={HOME} />
        </header>

        <section className="site-hero site-hero-split">
          <div className="site-hero-heading">
            <p className="funding-kicker">Thought capture</p>
            <h1>Messy thoughts that sort themselves.</h1>
          </div>
          <div className="site-hero-aside">
            <p className="funding-lede site-lede">
              Say it however it comes out. Capture turns it into an Action,
              Thread, or Intention without making you choose first.
            </p>
            <div className="site-actions">
              <Link className="capture-btn" href={APP}>
                {PLAYGROUND ? "Try Capture" : "Open Capture"}
              </Link>
              <Link className="ghost site-ghost" href="/install">
                Install locally
              </Link>
            </div>
            {PLAYGROUND && (
              <p className="site-cue">
                {TRIAL_LIMIT} captures a day. No account. This board stays in your browser.
              </p>
            )}
          </div>
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
          <LandingDemo />
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
                  poster: "/demos/it-learns.webp",
                  w: 1440,
                  h: 1230,
                  title: "It got it wrong. You told it once.",
                  note: "Undo asks what it should have been. The next one lands right, unasked.",
                },
                {
                  src: "/demos/next-step.mp4",
                  poster: "/demos/next-step.webp",
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
                    preload="none"
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

        <Movement
          id="use-cases"
          title="From a thought in motion to useful work"
          gloss="Three places where Capture earns its place."
        />
        <section className="site-card site-day" aria-label="Capture use cases">
          <dl className="note-beats">
            <div>
              <dt>On a walk</dt>
              <dd>
                You remember the signup bug and reconsider pricing in the same
                sentence. Capture lands the fix as an Action and pricing as a Thread.
              </dd>
            </div>
            <div>
              <dt>When the idea returns</dt>
              <dd>
                Another pricing thought arrives later. Say it rough. Capture
                adds it to the same Thread and keeps the summary current.
              </dd>
            </div>
            <div>
              <dt>Take it to your agent</dt>
              <dd>
                Copy and paste the Thread into Claude, Hermes, or Codex when
                you are ready to turn the pricing decision into a plan.
              </dd>
            </div>
          </dl>
        </section>

        {PLAYGROUND && (
          <>
            <Movement
              id="writing"
              title="What the rough thought became"
              gloss="Articles spoken in motion and finished in public."
            />
            <section className="site-card site-writing" aria-label="Writing made with Capture">
              <p className="funding-card-label">Written with Capture</p>
              <h2>I started writing while walking and running.</h2>
              <p>
                The finished articles sit beside selected source moments, so you
                can see what Capture kept and what the thought became.
              </p>
              <div className="site-actions">
                <Link className="ghost site-ghost" href="/writing">
                  Read the articles
                </Link>
              </div>
            </section>
          </>
        )}

        {/* The only proof on the page about a person rather than the
            software. It opens by naming the convention it is breaking,
            because a maker's note dressed up as a stranger's review would
            be worth less than nothing. The face goes first, so a reader
            knows a person is talking before reading a word of it. */}
        <Movement
            id="maker"
            title="Who built it, and on what"
            gloss="No reviews yet. Here is the honest version instead."
          />
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
            since. The four below are not customers — they are the work I
            was carrying while I used it.
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
        </section>

        <section className="site-card site-problem">
          <p className="funding-card-label">The point</p>
          <h2>The thought can arrive unfinished.</h2>
          <p>
            Capture is built for the sentence you actually produce, not a
            clean prompt. Nothing here is called a note.
          </p>
        </section>

        <Movement
            id="three-kinds"
            title="Three kinds of thing"
            gloss="Everything you say becomes one of these, and you never pick which one."
          />
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

        <Movement
          id="how-to"
          title="How to use Capture best"
          gloss="Start with the voice typing already on your device."
        />
        <section
          className="site-card site-voice"
          aria-label="Voice typing compatibility"
        >
          <p className="funding-card-label">Speech to text</p>
          <h2>Use the voice typing you already have.</h2>
          <p className="site-voice-intro">
            Capture does not need a special recording workflow. If a tool can
            type into the box, Capture can organize what you say.
          </p>
          <dl className="voice-options" aria-label="Voice typing options by device">
            <div>
              <dt>Built into Apple devices</dt>
              <dd>Apple Dictation</dd>
            </div>
            <div>
              <dt>iPhone</dt>
              <dd>
                <a
                  href="https://apps.apple.com/app/localwhisper/id6760680371"
                  target="_blank"
                  rel="noreferrer"
                >
                  LocalWhisper
                </a>
                <span aria-hidden="true"> · </span>
                <a href="https://wisprflow.ai/" target="_blank" rel="noreferrer">
                  Wispr Flow
                </a>
              </dd>
            </div>
            <div>
              <dt>Apple-silicon Mac</dt>
              <dd>
                <a
                  href="https://github.com/kitlangton/Hex"
                  target="_blank"
                  rel="noreferrer"
                >
                  Hex
                </a>
              </dd>
            </div>
            <div>
              <dt>Windows, Mac, and Linux</dt>
              <dd>
                <a href="https://handy.computer/" target="_blank" rel="noreferrer">
                  Handy
                </a>
              </dd>
            </div>
          </dl>
          <p className="site-voice-point">
            Start speaking before you decide how polished the thought should be.
          </p>
        </section>

        <Movement
            id="ownership"
            title="Yours to keep"
          />
        <section className="site-card site-proof">
          <p className="funding-card-label">Yours</p>
          <h2>Your thinking stays yours.</h2>
          <p>
            It runs locally, on your own keys, and exports to a file you
            keep. The product can disappear. Your thinking does not.
          </p>
          <div className="site-actions">
            <Link className="capture-btn" href={APP}>
              {PLAYGROUND ? `Try ${TRIAL_LIMIT} captures today` : "Open Capture"}
            </Link>
            <Link className="ghost site-ghost" href="/install">
              Install locally
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
