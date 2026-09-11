import Link from "next/link";
import { CopyPrompt } from "@/components/CopyPrompt";
import { GROQ_KEYS_URL, SETUP_GUIDE_URL } from "@/lib/install";
import { PLAYGROUND } from "@/lib/playground";
import { installMetadata, siteHome } from "@/lib/seo";
import { SiteNav } from "@/components/SiteNav";

export const metadata = installMetadata(PLAYGROUND);

const HOME = siteHome(PLAYGROUND);

export default function InstallPage() {
  return (
    <main className="capture-root site-page install-page">
      <div className="capture-wrap site-wrap">
        <header className="capture-head site-head">
          <Link className="capture-mark funding-mark" href={HOME}>
            capture<span>.</span>
          </Link>
          <SiteNav current="install" homeHref={HOME} />
        </header>

        <section className="site-hero install-hero">
          <p className="funding-kicker">Local installation</p>
          <h1>Your board. Your keys. Your machine.</h1>
          <p className="funding-lede site-lede">
            Give the prompt below to the coding agent you already use. It
            installs Capture locally, then stops before the model key so you
            can enter it yourself.
          </p>
        </section>

        <section
          className="site-card site-install"
          aria-label="Install Capture yourself"
        >
          <p className="funding-card-label">Agent install prompt</p>
          <CopyPrompt />
          <div className="site-actions">
            <a
              className="ghost site-ghost"
              href="https://github.com/glebbogachev00/capture"
              target="_blank"
              rel="noreferrer"
            >
              View on GitHub
            </a>
          </div>
          <ol className="site-install-steps">
            <li>
              Get a free key from{" "}
              <a href={GROQ_KEYS_URL} target="_blank" rel="noreferrer">
                the Groq console
              </a>
              .
            </li>
            <li>
              Run <code>npm run setup</code> in your own terminal. Paste the
              key there, not into a chat message or this website.
            </li>
            <li>
              Run <code>npm run dev</code>, then open{" "}
              <code>http://localhost:3000</code>.
            </li>
          </ol>
          <aside
            className="site-install-voice site-voice"
            aria-label="Voice typing for Capture"
          >
            <p className="funding-card-label">Optional voice typing</p>
            <h2>Add voice typing when you want it.</h2>
            <p>
              Apple Dictation works without extra setup. For longer thoughts,
              try{" "}
              <a
                href="https://apps.apple.com/app/localwhisper/id6760680371"
                target="_blank"
                rel="noreferrer"
              >
                LocalWhisper
              </a>{" "}
              or{" "}
              <a href="https://wisprflow.ai/" target="_blank" rel="noreferrer">
                Wispr Flow
              </a>{" "}
              on iPhone,{" "}
              <a
                href="https://github.com/kitlangton/Hex"
                target="_blank"
                rel="noreferrer"
              >
                Hex
              </a>{" "}
              on an Apple-silicon Mac, or{" "}
              <a href="https://handy.computer/" target="_blank" rel="noreferrer">
                Handy
              </a>{" "}
              on Windows, Mac, and Linux.
            </p>
            <p className="site-voice-point">
              If it types into Capture, Capture can organize it.
            </p>
          </aside>
          <p className="site-install-links">
            <a href={SETUP_GUIDE_URL} target="_blank" rel="noreferrer">
              Phone, hosting, and fallback-provider setup
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
