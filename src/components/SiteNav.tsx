"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { Menu, X } from "lucide-react";

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
  const [open, setOpen] = useState(false);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  return (
    <nav className="site-nav" aria-label="Capture links" data-open={open}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          button.current?.focus();
        }
      }}>
      <button ref={button} type="button" className="site-nav-toggle"
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {open ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
      </button>
      <div className="site-nav-links" id={id}>
      {sections.map((section) => {
        const href = section.id === "about" ? homeHref : section.href;
        const isCurrent = section.id === current;

        return (
          <Link
            className={isCurrent ? "site-nav-current" : undefined}
            href={href}
            aria-current={isCurrent ? "page" : undefined}
            key={section.id}
            onClick={() => setOpen(false)}
          >
            {section.label}
          </Link>
        );
      })}
      </div>
    </nav>
  );
}
