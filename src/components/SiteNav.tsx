import Link from "next/link";

type SiteSection = "about" | "writing" | "install" | "pricing";

const sections: Array<{ id: SiteSection; label: string; href: string }> = [
  { id: "about", label: "About", href: "/" },
  { id: "writing", label: "Writing", href: "/writing" },
  { id: "install", label: "Install", href: "/install" },
  { id: "pricing", label: "Pricing", href: "/pricing" },
];

export function SiteNav({
  current,
  homeHref = "/",
}: {
  current: SiteSection;
  homeHref?: string;
}) {
  return (
    <nav className="site-nav" aria-label="Capture links">
      {sections.map((section) => {
        const href = section.id === "about" ? homeHref : section.href;
        const isCurrent = section.id === current;

        return (
          <Link
            className={isCurrent ? "site-nav-current" : undefined}
            href={href}
            aria-current={isCurrent ? "page" : undefined}
            key={section.id}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
