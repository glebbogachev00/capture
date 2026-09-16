"use client";

import { useEffect } from "react";
import styles from "./LandingMotion.module.css";

/** Progressive decoration only: the server HTML is always fully visible. */
export function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(`.${styles.root}`);
    if (!root || typeof matchMedia !== "function" || typeof IntersectionObserver !== "function") return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;

    // Keep the video still; the existing input/output example owns its sequence.
    const targets = [...root.querySelectorAll<HTMLElement>(
      ".site-hero-heading, .site-hero-aside, .movement, .site-wrap > .site-card:not(.hero-clip), .kind-card, .feature-card-layout, .demo-split",
    )];
    const seen = new WeakSet<Element>();
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
    let stopped = false;
    const nativeScroll = typeof CSS !== "undefined" && CSS.supports("animation-timeline", "view()");
    const scrollTargets = nativeScroll ? targets.filter((target) => !target.matches(".site-hero-heading, .site-hero-aside, .demo-split")) : [];
    // Card motion follows scroll progress only. No timed entrance competes with it.
    scrollTargets.forEach((target) => target.classList.add(styles.flow));
    const clear = (target: HTMLElement) => {
      target.classList.remove(styles.enter);
      target.classList.remove(styles.sequence);
      target.style.removeProperty("--landing-delay");
      clearTimeout(timers.get(target));
      timers.delete(target);
    };
    const observer = new IntersectionObserver((entries) => {
      if (stopped) return;
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        if (scrollTargets.includes(target)) continue;
        if (!entry.isIntersecting) {
          clear(target);
          seen.delete(target);
          continue;
        }
        if (target.matches(".demo-split")) {
          if (!seen.has(target) && !target.contains(document.activeElement)) {
            seen.add(target);
            target.classList.add(styles.sequence);
            timers.set(target, setTimeout(() => clear(target), 2400));
          }
          continue;
        }
        if (!entry.isIntersecting || seen.has(target)) continue;
        seen.add(target);
        if (target.contains(document.activeElement)) continue;
        // Only cards in the same visible row receive a sibling stagger.
        let delay = 0;
        if (target.matches(".kind-card, .feature-card-layout")) {
          const top = target.getBoundingClientRect().top;
          delay = [...target.parentElement!.children].filter((sibling) =>
            sibling !== target && sibling.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING &&
            Math.abs(sibling.getBoundingClientRect().top - top) < 24,
          ).length * 120;
        }
        target.style.setProperty("--landing-delay", `${Math.min(delay, 240)}ms`);
        target.classList.add(styles.enter);
        if (target.matches(".site-hero-heading")) {
          timers.set(target, setTimeout(() => clear(target), 1800));
        }
      }
    }, { threshold: 0.15, rootMargin: "0px 0px -48px 0px" });
    const onEnd = (event: Event) => {
      if (event.target instanceof HTMLElement && targets.includes(event.target)) clear(event.target);
    };
    const onFocus = (event: FocusEvent) => {
      for (const target of targets) {
        if (event.target instanceof Node && target.contains(event.target)) {
          seen.add(target);
          clear(target);
        }
      }
    };
    const stop = () => {
      stopped = true;
      observer.disconnect();
      targets.forEach(clear);
      scrollTargets.forEach((target) => {
        target.classList.remove(styles.flow);
      });
    };
    const onPreference = () => { if (reduced.matches) stop(); };
    root.addEventListener("animationend", onEnd);
    root.addEventListener("focusin", onFocus);
    reduced.addEventListener("change", onPreference);
    targets.filter((target) => !scrollTargets.includes(target)).forEach((target) => observer.observe(target));
    return () => {
      stop();
      root.removeEventListener("animationend", onEnd);
      root.removeEventListener("focusin", onFocus);
      reduced.removeEventListener("change", onPreference);
    };
  }, []);
  return null;
}
