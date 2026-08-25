import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sponsor · capture",
  description:
    "Sponsor Capture's development while the full thinking system stays free and open source.",
};

const reasons = [
  {
    title: "One-person project",
    copy: "Sponsorship buys focused time for fixes, new work, and the maintenance that keeps Capture dependable.",
  },
  {
    title: "Free for everyone",
    copy: "The full thinking system stays free and open source. Sponsorship does not unlock a better version of it.",
  },
  {
    title: "No ads or attention tax",
    copy: "Capture will not fund itself by selling attention, adding sponsored clutter, or making the free product worse.",
  },
  {
    title: "Infrastructure that lasts",
    copy: "Support helps cover the services behind releases, demos, documentation, and the optional managed path.",
  },
  {
    title: "Development in public",
    copy: "The source, commits, issues, and releases stay visible. You can inspect the work you support.",
  },
  {
    title: "No sponsor-only thinking features",
    copy: "Sponsors help the project move. They do not get private tools that weaken the public product.",
  },
];

export default function SponsorPage() {
  return (
    <main className="capture-root funding-page sponsor-page">
      <div className="capture-wrap funding-wrap">
        <header className="capture-head funding-head">
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

        <section className="funding-hero sponsor-hero">
          <p className="funding-kicker">Sponsor Capture</p>
          <h1>Keep the thinking system free.</h1>
          <p className="funding-lede">
            Capture stays free and open source. I build it in public.
            Sponsorship pays for the time and infrastructure behind it.
            Sponsorship locks nothing.
          </p>
        </section>

        <section className="sponsor-checkout-grid" aria-label="Sponsor Capture">
          <div className="funding-card sponsor-promise">
            <p className="funding-card-label">The promise</p>
            <p className="funding-rule-text">
              Support the work. The product stays whole for everyone.
            </p>
            <p className="sponsor-note">
              Use Capture for free. Sponsor only if you want the project to
              move faster and stay well maintained.
            </p>
          </div>

          <div className="funding-card sponsor-action-card">
            <p className="funding-card-label">Once or regularly</p>
            <h2>Choose what fits.</h2>
            <p>
              Ko-fi handles the payment through the connected PayPal or Stripe
              account. You can send support without creating a Ko-fi account.
            </p>
            <div className="site-actions">
              <a
                className="capture-btn"
                href="https://ko-fi.com/banhmii"
                target="_blank"
                rel="noreferrer"
              >
                Continue to payment
              </a>
            </div>
            <p className="sponsor-fallback">
              The payment page offers one-time and monthly support.
            </p>
          </div>
        </section>

        <section className="sponsor-reasons" aria-label="What sponsorship supports">
          {reasons.map((reason) => (
            <article className="funding-card" key={reason.title}>
              <h2>{reason.title}</h2>
              <p>{reason.copy}</p>
            </article>
          ))}
        </section>

        <section className="funding-card sponsor-close">
          <p className="funding-card-label">Not ready to sponsor?</p>
          <h2>Using Capture, reporting a bug, or sharing it also helps.</h2>
          <div className="site-actions">
            <Link className="ghost site-ghost" href="/">
              Open Capture
            </Link>
            <a
              className="ghost site-ghost"
              href="https://github.com/glebbogachev00/capture/issues"
            >
              Report an issue
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
