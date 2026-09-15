// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LandingMotion } from "./LandingMotion";
import styles from "./LandingMotion.module.css";

let notify: IntersectionObserverCallback;
let change: () => void;
let preference: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
const observe = vi.fn(), unobserve = vi.fn(), disconnect = vi.fn();
function Fixture() {
  return <main className={styles.root}><LandingMotion /><div className="site-wrap"><div className="site-hero-heading"><h1>Always visible</h1></div><section className="site-card"><a href="#test">Link</a></section><section className="site-card hero-clip">Still video</section></div></main>;
}
function enter(target: Element) {
  act(() => notify([{ target, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
}
beforeEach(() => {
  vi.clearAllMocks();
  preference = { matches: false, addEventListener: vi.fn((_name, cb) => { change = cb; }), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", vi.fn(() => preference));
  vi.stubGlobal("CSS", { supports: () => false });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe = observe; unobserve = unobserve; disconnect = disconnect;
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("LandingMotion", () => {
  it("uses only scroll progress for cards when native timelines exist", () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const { container, unmount } = render(<Fixture />);
    const target = container.querySelector('.site-card')!;
    expect(target.classList.contains(styles.flow)).toBe(true);
    expect(observe).not.toHaveBeenCalledWith(target);
    enter(target);
    expect(target.classList.contains(styles.enter)).toBe(false);
    unmount();
    expect(target.classList.contains(styles.flow)).toBe(false);
  });
  it("does not measure and rewrite card geometry for each scroll frame", async () => {
    const { container } = render(<main className={styles.root}><LandingMotion /><article className="kind-card">Card</article></main>);
    const target = container.querySelector('.kind-card')!;
    const measure = vi.spyOn(target, 'getBoundingClientRect');
    await act(async () => {
      fireEvent.scroll(window);
      await new Promise(requestAnimationFrame);
    });
    expect(measure).not.toHaveBeenCalled();
    measure.mockRestore();
  });
  it("runs the input-to-cards sequence on entry, not in a continuous loop", () => {
    vi.useFakeTimers();
    const { container } = render(<main className={styles.root}><LandingMotion /><div className="demo-split"><p className="demo-in">Thought</p><ul className="demo-out"><li>Action</li><li>Thread</li></ul></div></main>);
    const target = container.querySelector('.demo-split')!;
    enter(target);
    expect(target.classList.contains(styles.sequence)).toBe(true);
    act(() => vi.advanceTimersByTime(2400));
    expect(target.classList.contains(styles.sequence)).toBe(false);
    enter(target);
    expect(target.classList.contains(styles.sequence)).toBe(false);
    act(() => notify([{ target, isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    enter(target);
    expect(target.classList.contains(styles.sequence)).toBe(true);
    act(() => { preference.matches = true; change(); });
    expect(target.classList.contains(styles.sequence)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("lets the headline assembly finish before clearing its entrance", () => {
    vi.useFakeTimers();
    const { container } = render(<Fixture />);
    const target = container.querySelector('.site-hero-heading')!;
    enter(target);
    act(() => vi.advanceTimersByTime(1400));
    expect(target.classList.contains(styles.enter)).toBe(true);
    act(() => vi.advanceTimersByTime(400));
    expect(target.classList.contains(styles.enter)).toBe(false);
  });
  it("starts visible, replays on re-entry, leaves video alone and clears completed animation", () => {
    const { container } = render(<Fixture />);
    const target = container.querySelector('.site-card')!;
    expect(observe).toHaveBeenCalledTimes(2);
    expect(target.classList.contains(styles.enter)).toBe(false);
    enter(target);
    expect(target.classList.contains(styles.enter)).toBe(true);
    expect(unobserve).not.toHaveBeenCalled();
    fireEvent.animationEnd(target);
    expect(target.classList.contains(styles.enter)).toBe(false);
    enter(target);
    expect(target.classList.contains(styles.enter)).toBe(false);
    act(() => notify([{ target, isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    enter(target);
    expect(target.classList.contains(styles.enter)).toBe(true);
  });
  it("does nothing with reduced motion or an unsupported observer", () => {
    preference.matches = true;
    const first = render(<Fixture />);
    expect(observe).not.toHaveBeenCalled(); first.unmount();
    preference.matches = false;
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<Fixture />);
    expect(observe).not.toHaveBeenCalled();
  });
  it("cancels immediately on runtime reduced motion and ignores queued callbacks", () => {
    const { container } = render(<Fixture />);
    const target = container.querySelector('.site-card')!; enter(target);
    act(() => { preference.matches = true; change(); });
    expect(disconnect).toHaveBeenCalled();
    expect(target.classList.contains(styles.enter)).toBe(false);
    enter(container.querySelector('.site-hero-heading')!);
    expect(container.querySelector(`.${styles.enter}`)).toBe(null);
  });
  it("keyboard focus cancels entrance and prevents a later observer entrance", () => {
    const { container } = render(<Fixture />);
    const target = container.querySelector('.site-card')!;
    fireEvent.focusIn(target.querySelector('a')!); enter(target);
    expect(target.classList.contains(styles.enter)).toBe(false);
  });
  it("unmount removes classes, inline delay and listeners", () => {
    const { container, unmount } = render(<Fixture />);
    const target = container.querySelector('.site-card') as HTMLElement; enter(target);
    unmount();
    expect(disconnect).toHaveBeenCalled();
    expect(target.classList.contains(styles.enter)).toBe(false);
    expect(target.style.getPropertyValue('--landing-delay')).toBe('');
    expect(preference.removeEventListener).toHaveBeenCalledWith('change', change);
  });
});
