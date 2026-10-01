"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { RecoveryDisclosure } from "./RecoveryDisclosure";
import { IntentionCard } from "@/app/Intentions";
import type { Intention, ProfileIdentity, ProfileUpdate } from "@/lib/model";
import { intentionDisplayNumbers } from "@/lib/intentionDisplay";
import "./IntentionShowcase.css";

type Props = {
  intentions: Intention[];
  profile?: ProfileIdentity;
  onProfileChange: (update: ProfileUpdate) => void | Promise<void>;
  onOpen: (id: string) => void;
};

/* Open or closed, and which intention is showing: this device's view of
   the showcase, not board data, so it neither syncs nor writes the board. */
const VIEW_KEY = "capture:intention-showcase";
type View = { open?: boolean; selected?: string };
function readView(): View {
  try { return JSON.parse(window.localStorage.getItem(VIEW_KEY) || "{}") ?? {}; } catch { return {}; }
}
function saveView(next: View) {
  try { window.localStorage.setItem(VIEW_KEY, JSON.stringify({ ...readView(), ...next })); } catch { /* view only */ }
}

function IntentionStack({ intentions, profile, onOpen, selected, onSelect }: Pick<Props, "intentions" | "profile" | "onOpen"> & {
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(() => Math.max(0, intentions.findIndex(item => item.id === selected)));
  /* The card on screen, for effects and scroll events that must not wait for a render. */
  const shown = useRef(active);
  const [fit, setFit] = useState<{ height: number; tail: number }>();
  const settling = useRef<ReturnType<typeof setTimeout>>(undefined);
  const card = (index: number) => viewport.current?.children[index] as HTMLElement | undefined;
  /* Each card keeps its own height, as in the Intentions tab, and the box
     takes the height of the card showing. It changes only after a scroll has
     settled; resizing mid-gesture was what made scrolling jump. The tail
     lets a last card shorter than the box still scroll to the top. */
  useLayoutEffect(() => {
    const content = card(active)?.firstElementChild;
    const last = card(intentions.length - 1)?.firstElementChild;
    if (!content || !last) return;
    const measure = () => {
      const height = Math.ceil(content.getBoundingClientRect().height);
      const tail = Math.max(0, height - Math.ceil(last.getBoundingClientRect().height));
      if (height > 0) setFit(current => current?.height === height && current.tail === tail ? current : { height, tail });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [active, intentions.length]);
  /* Line the card up when the box opens or changes height. */
  useLayoutEffect(() => {
    const target = card(shown.current);
    if (viewport.current && target) viewport.current.scrollTop = target.offsetTop;
  }, [fit]);
  useEffect(() => () => clearTimeout(settling.current), []);
  const show = (index: number) => {
    if (index === shown.current || !intentions[index]) return;
    shown.current = index;
    setActive(index);
    onSelect(intentions[index].id);
  };
  const nearest = (scrollTop: number) => intentions.reduce((best, _, index) =>
    Math.abs((card(index)?.offsetTop ?? 0) - scrollTop) < Math.abs((card(best)?.offsetTop ?? 0) - scrollTop) ? index : best, 0);
  return <div className="intention-showcase-stack" data-stacked={intentions.length > 1}>
    <div className="intention-showcase-viewport" style={fit && { height: fit.height, paddingBottom: fit.tail }} ref={viewport}
      role="group" aria-label="Pinned intentions" tabIndex={0}
      onScroll={event => {
        const box = event.currentTarget;
        clearTimeout(settling.current);
        settling.current = setTimeout(() => show(nearest(box.scrollTop)), 120);
      }}
      onKeyDown={event => {
        const target = { ArrowUp: active - 1, ArrowDown: active + 1, Home: 0, End: intentions.length - 1 }[event.key];
        if (target === undefined) return;
        event.preventDefault();
        const next = Math.max(0, Math.min(intentions.length - 1, target));
        event.currentTarget.scrollTo({ top: card(next)?.offsetTop ?? 0, behavior: "smooth" });
      }}>
      {intentions.map((item, index) => <article className="intention-showcase-card" key={item.id}
        aria-label={`Intention ${item.number}`} aria-hidden={index !== active} inert={index !== active}>
        <IntentionCard intention={item} hideNumber profile={profile} onOpen={() => onOpen(item.id)} />
      </article>)}
    </div>
  </div>;
}

function ShowcasePanel({ intentions, profile, onOpen }: Props) {
  const contentId = useId();
  const [view, setView] = useState<View>(readView);
  const update = (next: View) => { setView(current => ({ ...current, ...next })); saveView(next); };
  const collapsed = !view.open;
  const numbers = intentionDisplayNumbers(intentions);
  const byId = new Map(intentions.map(item => [item.id, { ...item, number: numbers.get(item.id)! }]));
  const selected = [...new Set(profile?.pinnedIntentionIds ?? [])].flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  return <section className="intention-showcase" data-collapsed={collapsed} aria-label="Intention showcase">
    <RecoveryDisclosure label="Intention showcase" count={selected.length} expanded={!collapsed} controls={contentId}
      onToggle={() => update({ open: collapsed })} />
    <div className="intention-showcase-content" id={contentId} hidden={collapsed}>
      {!collapsed && (selected.length ? <IntentionStack key={JSON.stringify(selected.map(item => item.id))} intentions={selected}
        profile={profile} onOpen={onOpen} selected={view.selected} onSelect={id => update({ selected: id })} /> :
        <p className="intention-showcase-empty">Pin intentions from the Intentions tab to show them here.</p>)}
    </div>
  </section>;
}

export function IntentionShowcase(props: Props) {
  return props.profile?.intentionShowcaseEnabled ? <ShowcasePanel {...props} /> : null;
}
