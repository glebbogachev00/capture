"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Older installations can retain the public home as their launch URL. */
export function InstalledAppEntry() {
  const router = useRouter();
  useEffect(() => {
    if (window.location.pathname !== "/") return;
    const installed = window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (installed) router.replace(`/app${window.location.search}${window.location.hash}`);
  }, [router]);
  return null;
}
