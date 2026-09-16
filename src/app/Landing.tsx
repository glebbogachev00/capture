import Link from "next/link";
import { PLAYGROUND, TRIAL_LIMIT } from "@/lib/playground";
import { PUBLIC_SITE } from "@/lib/publicSite";
import { siteHome, websiteSchema } from "@/lib/seo";
import { LandingDemo } from "@/components/LandingDemo";
import { SiteNav } from "@/components/SiteNav";
import { LandingThreadExample } from "@/components/LandingThreadExample";
import styles from "./Landing.module.css";

/** Where "open the app" points: the playground serves the board at /app so
    this page can hold the front door; a personal instance keeps it at /. */
const APP = PUBLIC_SITE ? "/app" : "/";
const HOME = siteHome(PUBLIC_SITE);

const kinds = [
  {
    name: "Actions",
    label: "Things to do",
    copy: "Tasks you mark done. Items with a shelf life fade when it expires, not because Capture knows you finished.",
  },
  {
    name: "Threads",
    label: "Ideas that grow",
    copy: "Related fragments collect over time. The summary updates as the idea changes, with the sources kept alongside it.",
  },
  {
    name: "Intentions",
    label: "Standing decisions",
    copy: "Directions you want to live by. They stay separate from tasks, with a check-in to ask whether you still mean them.",
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
      <h2>{title}</h2>
      {gloss && <p>{gloss}</p>}
    </div>
  );
}

export function Landing() {
  const schema = websiteSchema(PUBLIC_SITE);
  return (
    <main className={`capture-root site-page ${styles.landing}`}>
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
            <h1>Say it, write it. Capture sorts it out.</h1>
          </div>
          <div className="site-hero-aside">
            <p className="funding-lede site-lede">
              Put a task, a half-formed idea, and a decision in the same note.
              Capture separates them and keeps related thoughts together.
            </p>
            <p className={styles.fit}>For the thoughts that keep arriving while you work, make things, or figure out what comes next.</p>
            <div className="site-actions">
              <Link className="capture-btn" href={APP}>
                {PUBLIC_SITE ? "Try Capture" : "Open Capture"}
              </Link>
              <Link className="ghost site-ghost" href="/install">
                Install locally
              </Link>
            </div>
            {PUBLIC_SITE && (
              <p className="site-cue">
                {PLAYGROUND
                  ? `${TRIAL_LIMIT} captures a day in the free playground. No account needed.`
                  : "Free self-hosted. Optional paid Cloud. See pricing for availability."}
              </p>
            )}
          </div>
        </section>

        <LandingThreadExample />

        <Movement
            id="three-kinds"
            title="Different thoughts need different lives"
            gloss="Capture sorts for you. You can correct where something lands."
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


        <Movement id="use-cases" title="Keep the thought. Then put it to work." />
        <section className="site-card site-day" aria-label="Capture use cases">
          <p className="funding-card-label">Alongside the tools you already use</p>
          <h2>No folders to choose before the thought is safe.</h2>
          <p>Keep developing an idea here, or copy it into Notion or Obsidian. Capture is the place for the rough thought, not a demand to move your whole system.</p>
          <dl className="note-beats">
            <div>
              <dt>Find it again</dt>
              <dd>Search when a thought becomes useful. Open its Thread for the summary and the fragments behind it.</dd>
            </div>
            <div>
              <dt>Still working it out? Use Distill.</dt>
              <dd>Talk through an unclear thought, one question at a time. When it is ready, save what you settled back into Capture.</dd>
            </div>
          </dl>
        </section>
        <section className="site-card site-quiet" aria-label="Agent handoff">
          <p className="funding-card-label">Take the context with you</p>
          <h2>Your agent does not have to start from nothing.</h2>
          <p>Open a Thread and use Share to copy its summary and dated fragments. Paste them into Claude, Hermes, or Codex to continue the work.</p>
          <p className={styles.followup}>Share follows your current view: a Thread, an Intention, a tab list, or the selected day in the Record. This is a manual handoff, not an automatic integration.</p>
        </section>

        <section className="site-card site-voice" aria-label="Voice typing compatibility">
          <p className="funding-card-label">Voice or text</p>
          <h2>Start before the sentence is polished.</h2>
          <p>Type, use Capture’s microphone, or dictate with the tools you already have. If it can type into the box, Capture can sort the thought.</p>
          <details className={styles.voiceDetails}>
            <summary>Voice typing options</summary>
            <p>Apple Dictation, <a href="https://apps.apple.com/app/localwhisper/id6760680371" target="_blank" rel="noreferrer">LocalWhisper</a>, and <a href="https://wisprflow.ai/" target="_blank" rel="noreferrer">Wispr Flow</a> work on Apple devices. Try <a href="https://github.com/kitlangton/Hex" target="_blank" rel="noreferrer">Hex</a> on an Apple-silicon Mac, or <a href="https://handy.computer/" target="_blank" rel="noreferrer">Handy</a> on Windows, Mac, or Linux.</p>
          </details>
        </section>
        <section className="demo-reel" aria-label="Watch it work">
          <details className="reel-fold">
            <summary>Watch the product recordings</summary>
            <div className="site-card site-demo hero-clip"><LandingDemo /></div>
            <div className="reel-more">
              {[
                {
                  src: "/demos/it-learns.mp4",
                  poster: "/demos/it-learns.webp",
                  w: 1440,
                  h: 1230,
                  title: "It got it wrong. You told it once.",
                  note: "Correct a sort. Capture uses that correction when sorting later captures.",
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

        {PUBLIC_SITE && (
          <>
            <Movement
              id="writing"
              title="What the rough thought became"
              gloss="First-party use, with source moments you can read."
            />
            <section className="site-card site-writing" aria-label="Writing made with Capture">
              <p className="funding-card-label">Written with Capture</p>
              <h2>I started writing while walking and running.</h2>
              <p>
                I captured rough thoughts over several walks, developed them with
                Hermes, and edited the articles. The finished writing sits beside
                selected source moments. Capture kept the material; it did not write the articles.
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
            title="Built from daily use"
            gloss="A maker’s account, not a customer testimonial."
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

          <h2>I built it for the work I was carrying.</h2>
          <p>
            I built Capture for myself at the end of July and have used it
            every day since. These are projects I have used it on, not customers
            or endorsements.
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

        <Movement
            id="ownership"
            title="Yours to keep"
          />
        <section className="site-card site-proof">
          <p className="funding-card-label">Yours</p>
          <h2>Your thinking stays yours.</h2>
          <p>
            The playground saves your board in this browser. AI features send
            relevant content to model providers for processing. Export a backup
            before clearing browser data or changing devices.
          </p>
          <p className={styles.followup}>The full self-hosted system is free and open source. Cloud is optional and paid. <Link href="/pricing">See plans and availability</Link>.</p>
          <div className="site-actions">
            <Link className="capture-btn" href={APP}>
              {PUBLIC_SITE ? "Try Capture" : "Open Capture"}
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
