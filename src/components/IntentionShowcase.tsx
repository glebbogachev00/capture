"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
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

function IntentionStack({ intentions, profile, onOpen }: Pick<Props, "intentions" | "profile" | "onOpen">) {
  const viewport = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [height, setHeight] = useState(96);
  const viewportId = useId();
  useLayoutEffect(() => {
    const card = viewport.current?.children[active]?.firstElementChild;
    if (!card) return;
    const measure = () => {
      const next = Math.ceil(card.getBoundingClientRect().height);
      if (next > 0) setHeight(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [active]);
  useLayoutEffect(() => {
    if (viewport.current) viewport.current.scrollTop = active * height;
  }, [active, height]);
  const navigate = (index: number) => {
    const next = Math.max(0, Math.min(intentions.length - 1, index));
    viewport.current?.scrollTo({ top: next * viewport.current.clientHeight, behavior: "instant" });
    setActive(next);
  };
  return <>
    <div className="intention-showcase-stack" data-stacked={intentions.length > 1}>
      <div className="intention-showcase-viewport" style={{ height }} ref={viewport} id={viewportId}
        role="group" aria-label="Pinned intentions" tabIndex={0}
        onScroll={event => {
          const { scrollTop, clientHeight } = event.currentTarget;
          if (clientHeight) setActive(Math.max(0, Math.min(intentions.length - 1, Math.round(scrollTop / clientHeight))));
        }}
        onKeyDown={event => {
          const target = { ArrowUp: active - 1, ArrowDown: active + 1, Home: 0, End: intentions.length - 1 }[event.key];
          if (target !== undefined) { event.preventDefault(); event.currentTarget.focus(); navigate(target); }
        }}>
        {intentions.map((item, index) => <article className="intention-showcase-card" key={item.id}
          aria-label={`Intention ${item.number}`} aria-hidden={index !== active} inert={index !== active}>
          <IntentionCard intention={item} hideNumber profile={profile} onOpen={() => onOpen(item.id)} />
        </article>)}
      </div>
    </div>
    {intentions.length > 1 && <div className="intention-showcase-navigation">
      <button type="button" aria-label="Previous intention" aria-controls={viewportId} disabled={active === 0} onClick={() => navigate(active - 1)}>
        <ChevronUp size={18} strokeWidth={1.7} aria-hidden="true" />
      </button>
      <span role="status" aria-live="polite" aria-atomic="true">{active + 1} of {intentions.length}</span>
      <button type="button" aria-label="Next intention" aria-controls={viewportId} disabled={active === intentions.length - 1} onClick={() => navigate(active + 1)}>
        <ChevronDown size={18} strokeWidth={1.7} aria-hidden="true" />
      </button>
    </div>}
  </>;
}

function ShowcasePanel({ intentions, profile, onOpen }: Props) {
  const contentId = useId();
  const [collapsed, setCollapsed] = useState(true);
  const numbers = intentionDisplayNumbers(intentions);
  const byId = new Map(intentions.map(item => [item.id, { ...item, number: numbers.get(item.id)! }]));
  const selected = [...new Set(profile?.pinnedIntentionIds ?? [])].flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  return <section className="intention-showcase" data-collapsed={collapsed} aria-label="Intention showcase">
    <RecoveryDisclosure label="Intention showcase" count={selected.length} expanded={!collapsed} controls={contentId}
      onToggle={() => setCollapsed(value => !value)} />
    <div className="intention-showcase-content" id={contentId} hidden={collapsed}>
      {!collapsed && (selected.length ? <IntentionStack key={JSON.stringify(selected.map(item => item.id))} intentions={selected} profile={profile} onOpen={onOpen} /> :
        <p className="intention-showcase-empty">Pin intentions from the Intentions tab to show them here.</p>)}
    </div>
  </section>;
}

export function IntentionShowcase(props: Props) {
  return props.profile?.intentionShowcaseEnabled ? <ShowcasePanel {...props} /> : null;
}
