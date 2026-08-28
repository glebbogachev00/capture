"use client";

/**
 * The daily wrap, on screen.
 *
 * One day, one screen. The counts sit at the top because they are the part
 * that needs no reading; the sentence and the readings sit below because
 * they are the part worth stopping for. Nothing here is interactive except
 * leaving — this is a thing to look at, not a thing to work.
 */

import { useEffect } from "react";
import { Check, ChevronRight } from "lucide-react";
import type { DayWrap } from "@/lib/wrap";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Wednesday, 26 August" — the day named the way a person would say it. */
export function wrapDayName(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${DAYS[date.getDay()]}, ${d} ${MONTHS[m - 1]}`;
}

/**
 * What to call the day being wrapped.
 *
 * "Yesterday" almost always, because that is what it almost always is and
 * it is the word a person actually uses. A date tells you nothing about
 * what you are being offered; the weekday at least does when the wrap is
 * older than a day.
 */
export function wrapShort(day: string, now: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const then = new Date(y, m - 1, d);
  const today = new Date(now);
  const days = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      then.getTime()) /
      86400000
  );
  if (days <= 1) return "Yesterday";
  return DAYS[then.getDay()];
}

function hm(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The way in, on the record page.
 *
 * A line, not a card: it names the day and shows the day's own sentence, so
 * the decision to open it is made by reading the thing itself rather than by
 * decoding a label. It never displaces what the page is for.
 */
export function WrapCallout({
  wrap,
  onOpen,
}: {
  wrap: DayWrap;
  onOpen: () => void;
}) {
  return (
    <button className="wrap-callout" onClick={onOpen}>
      <span className="wrap-line-label">{wrapDayName(wrap.day)}</span>
      <span className="wrap-line-text">{wrap.line}</span>
      <ChevronRight size={14} strokeWidth={2} />
    </button>
  );
}

export function WrapView({
  wrap,
  onSeen,
}: {
  wrap: DayWrap;
  /** Opening the record IS reading it — there is nothing to dismiss. */
  onSeen?: () => void;
}) {
  useEffect(() => {
    onSeen?.();
    /* Once, on the first look. Re-running as the callback identity changes
       would keep re-committing the same board. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = wrap.stats;
  /* A wrap is frozen once written, so one stored before threads resolved
     properly still carries its unnamed rows — and a bar with "—" beside it
     is a hole with a chart next to it, not information. Filtered here as
     well as at the source, because the source cannot reach back into a day
     that has already been written. */
  const threads = (s.threads ?? []).filter(
    (t) => t.name && t.name.trim() && t.name.trim() !== "—"
  );
  const top = threads[0]?.n || 1;
  /* A chart of eleven threads where nine of them are a single bar is not a
     chart, it is a list wearing one. Show the few that carried the day and
     fold the rest into one honest row. */
  const SHOWN = 4;
  const shown = threads.slice(0, SHOWN);
  const rest = threads.slice(SHOWN);
  const restN = rest.reduce((n, t) => n + t.n, 0);
  /* One word each: two-word labels wrap on a phone, and a wrapped label
     shoves its own number down while its neighbours stay put, so the row
     stops reading as a row. */
  const counts: [string, number][] = [
    ["said", s.said],
    ["threads", s.threadsMoved],
    ["actions", s.actionsMade],
    ["intentions", s.intentions],
  ];

  return (
    <div className="wrap-sheet" role="dialog" aria-label="Daily wrap">
      <div className="wrap-day">{wrapDayName(wrap.day)}</div>
      <h2 className="wrap-title">What the day moved</h2>

      <div className="wrap-counts">
        {counts.map(([k, n]) => (
          <div className="wrap-count" key={k}>
            <div className="wrap-k">{k}</div>
            <div className="wrap-n">{n}</div>
          </div>
        ))}
      </div>

      {!!threads.length && (
        <div className="wrap-card">
          <div className="wrap-k">where the day went</div>
          <div className="wrap-bars">
            {shown.map((t) => (
              <div
                className="wrap-bar"
                key={t.name}
                style={{ ["--fill" as string]: `${Math.round((t.n / top) * 100)}%` }}
              >
                <div className="wrap-bar-name">{t.name}</div>
                <div className="wrap-k wrap-bar-n">{t.n}</div>
              </div>
            ))}
            {rest.length > 1 && (
              <div
                className="wrap-bar wrap-bar-rest"
                style={{ ["--fill" as string]: `${Math.round((restN / top) * 100)}%` }}
              >
                <div className="wrap-bar-name">{rest.length} more, once each</div>
                <div className="wrap-k wrap-bar-n">{restN}</div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="wrap-line-wrap">
        <div className="wrap-k">the day in one line</div>
        <p className="wrap-line">{wrap.line}</p>
      </div>

      {!!wrap.insights.length && (
        <div className="wrap-insights">
          {wrap.insights.map((i) => (
            <div className="wrap-insight" key={i.k}>
              <div className="wrap-k">{i.k}</div>
              <div className="wrap-insight-v">{i.v}</div>
            </div>
          ))}
        </div>
      )}

      {!!s.finished?.length && (
        <div className="wrap-done">
          <div className="wrap-k">
            {s.finished.length === 1
              ? "one thing you finished"
              : `${s.finished.length} things you finished`}
          </div>
          <ul className="wrap-done-list">
            {s.finished.map((f) => (
              <li key={f.at + f.text}>
                <Check size={13} strokeWidth={2.2} />
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!!wrap.tomorrow && (
        <div className="wrap-card wrap-tomorrow">
          <div className="wrap-k">tomorrow</div>
          <div className="wrap-insight-v">{wrap.tomorrow}</div>
        </div>
      )}

      <div className="wrap-span">
        {hm(s.firstAt)} — {hm(s.lastAt)}
      </div>
    </div>
  );
}
