import Link from "next/link";
import Image from "next/image";
import { MessagesSquare, Share2 } from "lucide-react";
import { PLAYGROUND, TRIAL_LIMIT } from "@/lib/playground";
import { siteHome, websiteSchema } from "@/lib/seo";
import { LandingDemo } from "@/components/LandingDemo";
import { SiteNav } from "@/components/SiteNav";
import "./landing-content.css";

/** Where "open the app" points: the playground serves the board at /app so
    this page can hold the front door; a personal instance keeps it at /. */
const APP = PLAYGROUND ? "/app" : "/";
const HOME = siteHome(PLAYGROUND);

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
    label: "What you need to do.",
    copy: "Tasks have a shelf life and fade when it ends. Keep the ones you still need.",
  },
  {
    name: "Threads",
    label: "Thoughts you’re still developing.",
    copy: "Related thoughts collect in one place, with a summary that updates as you add to them.",
  },
  {
    name: "Intentions",
    label: "Goals that guide your choices.",
    copy: "A direction to return to, not another task to finish. For example: “I build businesses that run without me.”",
  },
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
      <h2 id={`${id}-heading`}>{title}</h2>
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
            One capture can hold several thoughts. Capture separates them, so you do not have to choose a folder or tidy them first.
          </p>
        </section>
  );
  return (
    <main className="capture-root site-page landing-content">
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

        <section className="site-hero site-hero-split" aria-labelledby="landing-title">
          <div className="site-hero-heading">
            <p className="funding-kicker">Never lose a valuable thought or idea</p>
            <h1 id="landing-title">One place for all your thoughts, organized for you and easy to find.</h1>
          </div>
          <div className="site-hero-aside">
            <p className="funding-lede site-lede">
              Speak or type what’s on your mind. Capture separates things to do from ideas to keep, and brings related thoughts together.
            </p>
            <p className="site-cue">No folders to manage. No old tasks to clear out.</p>
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
          title="No deciding where to save it."
          gloss="Save a thought, find it later, and keep building on it."
        />
        <section className="site-card site-day" aria-label="Capture use cases">
          <dl className="note-beats">
            <div>
              <dt>Speak freely across topics</dt>
              <dd>
                Talk through several ideas and plans in one capture. Capture separates topics into new or existing threads and pulls out the things to do.
              </dd>
            </div>
            <div>
              <dt>No wondering where you put it.</dt>
              <dd>
                Search the words you remember. Find the thought and the context around it, without checking several apps.
              </dd>
            </div>
            <div>
              <dt>Give your AI the whole idea.</dt>
              <dd>
                Copy a thread into Claude, Hermes, or the AI you already use. It includes the summary and everything you’ve added, with dates. You choose what to copy and paste.
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
            since. The four below are not customers. They are the work I
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
          <h2>No folders to manage. No old tasks to clear out.</h2>
          <p>
            Short-lived tasks fade. Developing ideas stay together. You don’t need to file every new thought or delete every expired task.
          </p>
          <div className="site-other-apps" aria-labelledby="other-apps-title">
            <h3 id="other-apps-title">Keep the apps you already use.</h3>
            <p>Capture is not a replacement for Notion or Obsidian. It makes thoughts easy to capture, organize, and find. Develop them in Capture, or copy them into the app you choose.</p>
            <ul className="site-app-logos" aria-label="Apps you can keep using">
              <li>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brands/notion.png" width={28} height={28} alt="" /><span>Notion</span>
              </li>
              <li>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brands/obsidian.svg" width={28} height={28} alt="" /><span>Obsidian</span>
              </li>
            </ul>
          </div>
        </section>

        <Movement
            id="three-kinds"
            title="Different thoughts need different places."
            gloss="Capture chooses where they belong. You don’t have to choose first."
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

        <section className="feature-chapter" aria-labelledby="distill-heading">
          <Movement id="distill" title="When you need to think it through." gloss="Clarify an idea or decision before you save it." />
        <section className="site-card site-distill feature-card-layout" aria-labelledby="distill-title">
          <div className="feature-card-copy">
            <h3 id="distill-title">Distill mode</h3>
            <p>Not sure what you mean yet? Distill is a short AI conversation that helps you clarify an idea or decision. Review the result, then save it as an Action, Thread, or Intention.</p>
          </div>
          <figure className="feature-card-image">
            <div className="feature-screenshot-frame">
              <Image src="/screenshots/distill-mode.png" alt="Distill in Capture, with an app idea ready to discuss" width={1168} height={1140} unoptimized />
            </div>
            <figcaption className="feature-access-cue"><span className="feature-control-icon"><MessagesSquare size={18} strokeWidth={1.7} aria-hidden="true" /></span><span>Tap this icon beside Capture to open Distill.</span></figcaption>
          </figure>
        </section>

        </section>

        <section className="feature-chapter" aria-labelledby="handoff-heading">
          <Movement id="handoff" title="Your history, ready for your agent." gloss="Share the thoughts you choose, with their context included." />
        <section className="site-card site-quiet feature-card-layout" aria-labelledby="handoff-title">
          <div className="feature-card-copy">
            <h3 id="handoff-title">Agent handoff</h3>
            <dl className="note-beats">
              <div><dt>Pick a day</dt><dd>Open The Record. Its heat map shows your capture history. Click any day to revisit what you captured that day.</dd></div>
              <div><dt>Share what you’re viewing</dt><dd>Click Share. In The Record, it shares that day’s captures. In a thread, it shares the summary and dated notes. On a tab, it shares that tab’s list.</dd></div>
              <div><dt>Continue with your agent</dt><dd>Use your device’s share menu, or copy and paste into Claude, Hermes, or another agent. No collecting scattered notes or explaining everything again.</dd></div>
            </dl>
          </div>
          <figure className="feature-card-image">
            <Image src="/screenshots/record-heatmap.png" alt="The Record heat map in Capture, showing sample history with one day selected" width={920} height={536} unoptimized />
            <figcaption>Example capture history, with a day selected.</figcaption>
            <div className="feature-access-cue"><span className="feature-control-icon"><Share2 size={18} strokeWidth={1.7} aria-hidden="true" /></span><span>Tap the counts below Capture’s name to open The Record. Pick a day, then tap Share.</span></div>
          </figure>
        </section>

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
            Type it, or use your device’s voice typing. You don’t need to tidy it first.
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
            Your thoughts stay in this browser. Export a backup before clearing browser data.
          </p>
          <div className="site-actions">
            <Link className="capture-btn" href={APP}>
              {PLAYGROUND ? `Try ${TRIAL_LIMIT} captures today` : "Open Capture"}
            </Link>
            <Link className="ghost site-ghost" href="/install">
              Install locally
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
