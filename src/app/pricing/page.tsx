import Link from "next/link";
import { utilityMetadata } from "@/lib/seo";
import { CloudCheckoutButton } from "@/components/CloudBilling";
import { SiteNav } from "@/components/SiteNav";
import { PLAYGROUND } from "@/lib/playground";
import { siteHome } from "@/lib/seo";

export const metadata = utilityMetadata(
  "Pricing",
  "Capture stays free and open source. Paid Cloud covers hosting, sync, backup, and managed AI."
);

const freeItems = [
  "Fast capture",
  "Threads",
  "Intentions",
  "Actions",
  "Distill and cleanup",
  "Local storage",
  "Import and export",
  "Bring your own AI keys",
];

const cloudItems = [
  "Sync without setup",
  "Backups without maintenance",
  "Managed AI for normal personal use",
  "Publishing and hosting when you need a public surface",
];

const fitItems = [
  {
    name: "Self-hosted",
    copy: "For people who want control, already have AI keys, or prefer to run their thinking system themselves.",
  },
  {
    name: "Capture Cloud",
    copy: "For people who want the same system synced, backed up, and ready without managing servers, keys, or hosting.",
  },
];

const plans = [
  {
    name: "Free",
    price: "$0",
    note: "Self-hosted. Full thinking system.",
    plan: null,
    action: "Install it yourself",
  },
  {
    name: "Cloud monthly",
    price: "$5/mo",
    note: "Use it when you want the hosted version.",
    plan: "monthly" as const,
    action: "Choose monthly",
  },
  {
    name: "Cloud yearly",
    price: "$50/yr",
    note: "Two months free. Best default for Cloud.",
    plan: "yearly" as const,
    action: "Choose yearly",
    recommended: true,
  },
];

const HOME = siteHome(PLAYGROUND);

export default async function PricingPage({
  searchParams,
}: {
  searchParams?: Promise<{ checkout?: string | string[] }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const checkout = params?.checkout;
  const resumePlan = checkout === "monthly" || checkout === "yearly" ? checkout : null;

  return (
    <main className="capture-root site-page funding-page">
      <div className="capture-wrap funding-wrap">
        <header className="capture-head site-head funding-head">
          <Link className="capture-mark funding-mark" href={HOME}>
            capture<span>.</span>
          </Link>
          <SiteNav current="pricing" homeHref={HOME} />
        </header>

        <section className="funding-hero">
          <p className="funding-kicker">Capture pricing</p>
          <h1>Own your thinking. Pay only for hosting.</h1>
          <p className="funding-lede">
            Capture is not a subscription trap for your notes. The full thinking
            system stays free and open source. Cloud exists for people who want
            the managed path.
          </p>
        </section>

        <section className="funding-card funding-rule-card">
          <p className="funding-card-label">Decision rule</p>
          <p className="funding-rule-text">
            If removing a paid service makes the free product worse at thinking,
            it is the wrong thing to charge for.
          </p>
        </section>

        <section className="funding-grid" aria-label="What stays free">
          <div className="funding-card">
            <p className="funding-card-label">Free forever includes</p>
            <ul className="funding-list">
              {freeItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="funding-card">
            <p className="funding-card-label">Capture Cloud is optional</p>
            <p>
              Cloud does not buy a better thinking system. It buys less setup,
              less maintenance, and less risk of losing work.
            </p>
            <ul className="funding-list compact">
              {cloudItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="funding-card">
          <p className="funding-card-label">Which version is for you?</p>
          <div className="fit-row">
            {fitItems.map((item) => (
              <article className="fit-card" key={item.name}>
                <h2>{item.name}</h2>
                <p>{item.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="funding-card">
          <p className="funding-card-label">Pricing</p>
          <div className="pricing-row">
            {plans.map((plan) => (
              <article className={`pricing-card${plan.plan === "yearly" ? " featured" : ""}`} key={plan.name}>
                <div className="pricing-card-head">
                  <p>{plan.name}</p>
                  {"recommended" in plan && plan.recommended && (
                    <span className="pricing-badge">Best value</span>
                  )}
                </div>
                <strong>{plan.price}</strong>
                <span>{plan.note}</span>
                {plan.plan ? (
                  <CloudCheckoutButton
                    plan={plan.plan}
                    autoStart={resumePlan === plan.plan}
                  >
                    {plan.action}
                  </CloudCheckoutButton>
                ) : (
                  <div className="cloud-action">
                    <Link className="capture-btn cloud-inline-link" href="/install">{plan.action}</Link>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="funding-card supporter-card">
          <p className="funding-card-label">Supporter program</p>
          <h2>Optional support. No locked thinking features.</h2>
          <p>
            Supporters can give once or recur. They help keep the free system
            strong. They do not get exclusive thinking features.
          </p>
        </section>

        <section className="funding-card supporter-card">
          <p className="funding-card-label">AI use</p>
          <h2>Managed AI should not make thinking feel metered.</h2>
          <p>
            Cloud includes managed AI for normal personal use. Heavy users can
            bring their own key and keep going.
          </p>
        </section>
      </div>
    </main>
  );
}
