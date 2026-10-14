import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";
import { PUBLIC_SITE } from "@/lib/publicSite";
import { siteHome } from "@/lib/seo";

const HOME = siteHome(PUBLIC_SITE);

/** Privacy and Terms share one plain layout: a title, a date, short sections. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="capture-root site-page legal-page">
      <div className="capture-wrap site-wrap">
        <header className="capture-head site-head">
          <Link className="capture-mark funding-mark" href={HOME}>
            capture<span>.</span>
          </Link>
          <SiteNav homeHref={HOME} />
        </header>
        <article className="legal">
          <h1>{title}</h1>
          <p className="legal-updated">Last updated {updated}</p>
          {children}
        </article>
        <SiteFooter />
      </div>
    </main>
  );
}
