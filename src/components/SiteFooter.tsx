import Link from "next/link";

/** The small print every public page ends on. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Link href="/privacy">Privacy</Link>
      <Link href="/terms">Terms</Link>
      <a href="mailto:gleb@trycapture.app">Contact</a>
    </footer>
  );
}
