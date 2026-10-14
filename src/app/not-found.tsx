import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { PUBLIC_SITE } from "@/lib/publicSite";
import { siteHome } from "@/lib/seo";

const HOME = siteHome(PUBLIC_SITE);

/** A wrong link lands somewhere that still looks like Capture, with one way on. */
export default function NotFound() {
  return (
    <main className="capture-root site-page">
      <div className="capture-wrap site-wrap">
        <header className="capture-head site-head">
          <Link className="capture-mark funding-mark" href={HOME}>
            capture<span>.</span>
          </Link>
          <SiteNav homeHref={HOME} />
        </header>
        <section className="site-hero">
          <p className="funding-kicker">404</p>
          <h1>This page isn’t here.</h1>
          <p className="funding-lede site-lede">The link may be old, or mistyped.</p>
          <div className="site-actions">
            <Link className="capture-btn" href={HOME}>Go to Capture</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
