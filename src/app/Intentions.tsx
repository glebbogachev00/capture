"use client";

/* ============================================================
   INTENTIONS — carried over from the standalone intent app.

   An intention is declared, not closed. It is written in present
   tense as already true; its recommended actions are things you
   do BECAUSE it is already so, not steps toward making it so.
   That is why none of this has a checkbox or a shelf life: an
   action is finished, an intention is inhabited.
   ============================================================ */

import { useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  X,
  MoreHorizontal,
} from "lucide-react";
import { type Intention, type Principle, type Thread, fmt, pad } from "@/lib/model";
import { snapshotLabel } from "@/lib/snapshots";
import type { RulePreference } from "@/lib/rules";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { ReportBugForm } from "@/components/ReportBug";
import { CaptureProfile } from "@/components/CaptureProfile";
import { PLAYGROUND } from "@/lib/playground";
import type { CaptureEntry } from "@/lib/ledger";
import type { DayWrap } from "@/lib/wrap";
import { WrapView, WrapCallout } from "./Wrap";
import {
  heatGrid,
  caughtWords,
  dayCaptures,
  dayKey,
  monthLabels,
  recordStats,
} from "@/lib/record";

const PROFILE_DEFAULTS = {
  name: process.env.NEXT_PUBLIC_CAPTURE_PROFILE_NAME ?? "",
  image: process.env.NEXT_PUBLIC_CAPTURE_PROFILE_IMAGE ?? "",
};

export type Draft = {
  rawInput: string;
  expandedIntention: string;
  recommendedActions: string[];
  counterIntentions: string[];
};

/** A list you can add to and remove from, used for both halves. */
function EditableList({
  label,
  note,
  items,
  placeholder,
  onAdd,
  onRemove,
}: {
  label: string;
  note?: string;
  items: string[];
  placeholder: string;
  onAdd: (v: string) => void;
  onRemove: (i: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const v = draft.trim();
    if (!v) return;
    onAdd(v);
    setDraft("");
  };

  return (
    <div className="int-block">
      <h4 className="int-label">{label}</h4>
      {note && <p className="int-note">{note}</p>}
      <ul className="int-list">
        {items.map((t, i) => (
          <li key={i}>
            <span>{t}</span>
            <button
              className="ghost"
              onClick={() => onRemove(i)}
              aria-label={"Remove: " + t}
            >
              <X size={16} strokeWidth={2} />
            </button>
          </li>
        ))}
      </ul>
      <div className="int-add">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        <button className="ghost" onClick={commit} disabled={!draft.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}

/**
 * The review step before an intention is saved.
 *
 * intent always let you see and reshape what the engine wrote before it
 * became a record, which matters more here than it does for actions — an
 * intention you did not quite mean is worse than no intention.
 */
export function IntentionDraft({
  draft,
  busy,
  onChange,
  onSave,
  onDiscard,
  onThreadInstead,
}: {
  draft: Draft;
  busy: boolean;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onDiscard: () => void;
  onThreadInstead: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="int-draft">
      <div className="int-eyebrow">New intention</div>

      {editing ? (
        <textarea
          className="int-expanded-edit"
          value={draft.expandedIntention}
          onChange={(e) =>
            onChange({ ...draft, expandedIntention: e.target.value })
          }
          onBlur={() => setEditing(false)}
          aria-label="Expanded intention"
          autoFocus
        />
      ) : (
        <p className="int-expanded" onClick={() => setEditing(true)}>
          {draft.expandedIntention}
        </p>
      )}

      <div className="act-meta">
        <button className="ghost" onClick={() => setEditing(true)}>
          Edit wording
        </button>
        {/* The escape from a wrong classification, asked for three times:
            everything said goes back through the sorter as a thread — the
            FULL dictation, not this condensed reading of it. Next to Edit
            wording because that is where the eye goes when the words feel
            wrong. */}
        <button className="ghost" onClick={onThreadInstead} disabled={busy}>
          It&apos;s a thread, not an intention
        </button>
      </div>

      <EditableList
        label="Recommended actions"
        note="Taken from the fulfilled state — things you do because this is already so."
        items={draft.recommendedActions}
        placeholder="Add an action"
        onAdd={(v) =>
          onChange({
            ...draft,
            recommendedActions: [...draft.recommendedActions, v],
          })
        }
        onRemove={(i) =>
          onChange({
            ...draft,
            recommendedActions: draft.recommendedActions.filter(
              (_, x) => x !== i
            ),
          })
        }
      />

      <EditableList
        label="Counter-intentions"
        note="The recurring behaviours pulling against this one."
        items={draft.counterIntentions}
        placeholder="Add a counter-intention"
        onAdd={(v) =>
          onChange({
            ...draft,
            counterIntentions: [...draft.counterIntentions, v],
          })
        }
        onRemove={(i) =>
          onChange({
            ...draft,
            counterIntentions: draft.counterIntentions.filter(
              (_, x) => x !== i
            ),
          })
        }
      />

      <div className="int-commit">
        <button className="capture-btn" onClick={onSave} disabled={busy}>
          Save intention
        </button>
        <button className="ghost warn" onClick={onDiscard} disabled={busy}>
          Discard
        </button>
      </div>
    </div>
  );
}

export function IntentionCard({
  intention,
  onOpen,
}: {
  intention: Intention;
  onOpen: () => void;
}) {
  return (
    <button className="tcard" onClick={onOpen}>
      <div className="int-number">({pad(intention.number)})</div>
      <div className="int-card-text">{intention.expandedIntention}</div>
      <div className="act-meta" style={{ marginTop: 9 }}>
        {intention.recommendedActions.length} action
        {intention.recommendedActions.length === 1 ? "" : "s"} ·{" "}
        {intention.counterIntentions.length} counter ·{" "}
        {fmt(intention.at)}
      </div>
    </button>
  );
}

export function IntentionDetail({
  intention,
  onBack,
  onChange,
  onCopy,
  onDelete,
}: {
  intention: Intention;
  onBack: () => void;
  onChange: (next: Intention) => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [more, setMore] = useState(false);
  const [said, setSaid] = useState(false);

  /* What was actually said, when it is not simply the same sentence.
 
     An intention keeps both: rawInput, the person's own words, and
     expandedIntention, the model's version of them. Only the second was
     ever rendered — so four minutes of talking produced two lines on a
     card, the rest sat in the board unreachable, and the honest report of
     that was "a lot of things I said got lost". Nothing was lost; nothing
     was shown. */
  const spoken = (intention.rawInput ?? "").trim();
  const hasSpoken =
    spoken.length > 0 &&
    spoken !== (intention.expandedIntention ?? "").trim();

  return (
    <div>
      <button className="back" onClick={onBack}>
        ← all intentions
      </button>

      <div className="int-number">({pad(intention.number)})</div>

      {editing ? (
        <textarea
          className="int-expanded-edit"
          value={intention.expandedIntention}
          onChange={(e) =>
            onChange({ ...intention, expandedIntention: e.target.value })
          }
          onBlur={() => setEditing(false)}
          aria-label="Expanded intention"
          autoFocus
        />
      ) : (
        <p className="int-expanded">{intention.expandedIntention}</p>
      )}

      <div style={{ marginBottom: 18 }}>
        <div className="act-meta">
          <button className="copy-btn" onClick={onCopy} aria-label="Copy">
            <Copy size={16} strokeWidth={1.6} />
          </button>
          <button
            className={"more-btn" + (more ? " open" : "")}
            onClick={() => {
              setMore((v) => !v);
              setConfirming(false);
            }}
            aria-expanded={more}
            aria-label={more ? "Fewer options" : "More options"}
          >
            <MoreHorizontal size={16} strokeWidth={1.8} />
          </button>
        </div>

        {more && (
          <div className="row-actions">
            <button className="ghost" onClick={() => setEditing(true)}>
              Edit wording
            </button>
            <button
              className="ghost warn"
              onClick={() => setConfirming((v) => !v)}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {confirming && (
        <ConfirmDelete
          title={`Delete intention ${pad(intention.number)}?`}
          onConfirm={onDelete}
          onCancel={() => setConfirming(false)}
        />
      )}

      <EditableList
        label="Recommended actions"
        note="Taken from the fulfilled state — things you do because this is already so."
        items={intention.recommendedActions}
        placeholder="Add an action"
        onAdd={(v) =>
          onChange({
            ...intention,
            recommendedActions: [...intention.recommendedActions, v],
          })
        }
        onRemove={(i) =>
          onChange({
            ...intention,
            recommendedActions: intention.recommendedActions.filter(
              (_, x) => x !== i
            ),
          })
        }
      />

      <EditableList
        label="Counter-intentions"
        note="The recurring behaviours pulling against this one."
        items={intention.counterIntentions}
        placeholder="Add a counter-intention"
        onAdd={(v) =>
          onChange({
            ...intention,
            counterIntentions: [...intention.counterIntentions, v],
          })
        }
        onRemove={(i) =>
          onChange({
            ...intention,
            counterIntentions: intention.counterIntentions.filter(
              (_, x) => x !== i
            ),
          })
        }
      />

      {hasSpoken && (
        /* Folded, and last. The expanded intention is the thing to act on;
           this is the record behind it, wanted occasionally and never in
           the way. */
        <div className="int-said">
          <button
            className="int-said-open"
            onClick={() => setSaid((v) => !v)}
            aria-expanded={said}
          >
            {said ? "Hide what you said" : "What you said"}
          </button>
          {said && <p className="int-said-text">{spoken}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * A file button that opens the picker on iOS.
 *
 * Safari will not reliably open a picker from a label-tap, however the input
 * is rendered — the tap just lands on the label and dies. The pattern that
 * works everywhere (including a PWA on an iPhone) is a real button that calls
 * `input.click()` directly. The input itself stays in the DOM, clipped rather
 * than display:none, because that keeps it a genuine, focusable control.
 */
function FileButton({
  label,
  onFile,
}: {
  label: string;
  onFile: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="ghost"
        onClick={() => ref.current?.click()}
      >
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="application/json,.json"
        className="clipped"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </>
  );
}

function Note({ note }: { note: { text: string; ok: boolean } | null }) {
  if (!note) return null;
  return <p className={"io-note" + (note.ok ? " ok" : " bad")}>{note.text}</p>;
}

export type IoNote = { text: string; ok: boolean } | null;

/**
 * Settings: getting data in and out, and the principles engine.
 *
 * Export matters more than any of the rest. Everything this app knows lives
 * in one browser's IndexedDB, so without a file on disk somewhere, clearing
 * site data takes all of it.
 */
/**
 * The one thing the tiles cannot say.
 *
 * This used to be a full sentence — "138 things said since May 27, 67 became
 * actions, 70 joined threads…" — sitting directly above tiles carrying every
 * one of those numbers again. The tiles won; what is left is the span of
 * time, and how much of it was spoken rather than typed.
 */
function sinceLine(stats: ReturnType<typeof recordStats>): string {
  const when = stats.since
    ? new Date(stats.since).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
      })
    : "";
  const voice = stats.dictated ? ` · ${stats.dictated} arrived by voice` : "";
  return `since ${when}${voice}`;
}

/**
 * The record — the capture ledger, made visible on its own page. One
 * sentence of what the app has done with everything said to it, and twelve
 * weeks of days. A colophon, not a scoreboard: no streaks, no goals, and
 * an empty day is a pale cell, never a broken chain. Opened from the
 * masthead count — the one line that is always on screen.
 */
export function RecordScreen({
  ledger,
  now,
  day,
  onDayChange,
  onBack,
  rules,
  onToggleRule,
  threads,
  onOpenThread,
  onRestore,
  wrap,
  onWrapSeen,
}: {
  ledger: CaptureEntry[];
  now: number;
  /** The Record's selected heat-map day, shared with the header control. */
  day: string;
  onDayChange: (day: string) => void;
  onBack: () => void;
  /* Yesterday's reading. It lives here rather than on the board: the record
     is already the place days are looked back on, and the heat map right
     below says which days were worth looking at. On the board it was
     clutter — a statement wedged into a stack of tools. */
  wrap?: DayWrap | null;
  onWrapSeen?: () => void;
  /* Advisory sorting preferences remain reversible and hidden until asked. */
  rules: RulePreference[];
  onToggleRule: (key: string, enabled: boolean) => void;
  /** The threads used for both landing names and the recurring profile reading. */
  threads: Thread[];
  onOpenThread: (id: string) => void;
  /** Put an undone capture's words back in the composer — the way back for
      anything discarded: said again, sorted fresh. */
  onRestore: (said: string) => void;
}) {
  const [openWrap, setOpenWrap] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showRules, setShowRules] = useState(false);
  /* The page's real subject: ONE day. Its owner is the Capture shell so the
     global header and the heat map always use the same scope. */
  const stats = recordStats(ledger);
  const grid = heatGrid(ledger, now);
  const months = monthLabels(grid);
  const caught = caughtWords(ledger);
  const selectedCaptures = dayCaptures(ledger, day);
  const today = day === dayKey(now);
  const dayName = (day: string) =>
    new Date(day + "T12:00:00").toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
    });
  /* The day is its own page, one step further in: capture → the record →
     the day. Unfolding it inside the record left the record's own title and
     figures wrapped around it, which read as an accident rather than a
     choice. One screen, one thing. */
  if (wrap && openWrap) {
    return (
      <div>
        <button className="back" onClick={() => setOpenWrap(false)}>
          ← the record
        </button>
        <WrapView wrap={wrap} onSeen={onWrapSeen} />
      </div>
    );
  }

  return (
    <div>
      <button className="back" onClick={onBack}>
        ← capture
      </button>

      <div className="tname" style={{ fontSize: 26, marginBottom: 10 }}>
        The record
      </div>

      {/* A call-out, not the reading. The record is a page you come to for
          a reason; yesterday's wrap announces itself in one line here and
          opens as its own page, so it never displaces what you came for. */}
      {wrap && (
        <WrapCallout wrap={wrap} onOpen={() => setOpenWrap(true)} />
      )}



      {!ledger.length ? (
        <div className="empty record-empty">
          <p className="big">The record is quiet.</p>
          <p>Your first capture will leave a trace here.</p>
        </div>
      ) : (
        <>
          {/* The numbers as their own objects, the way a stats panel reads —
              glanceable first, sentence second. */}
          <div className="record-tiles">
            <div className="record-tile">
              <span className="record-tile-label">Said</span>
              <b>{stats.total}</b>
            </div>
            <div className="record-tile">
              <span className="record-tile-label">Actions</span>
              <b>{stats.actions}</b>
            </div>
            <div className="record-tile">
              <span className="record-tile-label">Threads</span>
              <b>{stats.threads}</b>
            </div>
            <div className="record-tile">
              <span className="record-tile-label">Intentions</span>
              <b>{stats.intentions}</b>
            </div>
          </div>
          <p className="record-caption" style={{ marginBottom: 22 }}>
            {sinceLine(stats)}
          </p>

          <div className="record-profile-stack">
            <div className="record-frame">
              <div className="record-grid">
                {grid.map((week) => (
                  <div className="record-col" key={week[0].day}>
                    {week.map((cell) => (
                      /* Each cell IS its day — tap it and the story below
                         becomes that day's. */
                      <button
                        key={cell.day}
                        className={
                          "record-cell l" +
                          cell.level +
                          (cell.day === day ? " record-cell-open" : "")
                        }
                        aria-pressed={cell.day === day}
                        onClick={() => {
                          onDayChange(cell.day);
                          setShowHistory(true);
                        }}
                        title={`${dayName(cell.day)} · ${cell.count} capture${cell.count === 1 ? "" : "s"}`}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div className="record-months">
                {months.map((m, i) => (
                  <span key={grid[i][0].day}>{m}</span>
                ))}
              </div>
              {/* One line, not five numbers. The grid has already shown the
                  shape of the weeks; this says how much of it there is, in
                  something a person can picture. */}
              <p className="record-caption record-profile-caption">
                {caught
                  ? `about ${caught.words.toLocaleString()} words caught — ${caught.like}`
                  : "the last twelve weeks, day by day"}
              </p>
            </div>
            <CaptureProfile
              threads={threads}
              onOpenThread={onOpenThread}
              defaults={PROFILE_DEFAULTS}
            />
          </div>

          <div className="record-section">
            <button
              className="record-disclosure"
              onClick={() => setShowHistory((value) => !value)}
              aria-expanded={showHistory}
              aria-label={`${showHistory ? "Hide" : "Show"} ${
                today ? "today's history" : `${dayName(day)} history`
              }`}
            >
              <span className="record-disclosure-title">
                {today ? "Today's history" : dayName(day)}
              </span>
              <span className="record-disclosure-meta">
                {selectedCaptures.length
                  ? `${selectedCaptures.length} capture${
                      selectedCaptures.length === 1 ? "" : "s"
                    }`
                  : "quiet"}
              </span>
              {showHistory ? (
                <ChevronUp size={21} strokeWidth={1.7} />
              ) : (
                <ChevronDown size={21} strokeWidth={1.7} />
              )}
            </button>

            {showHistory && (
              <div className="record-disclosure-body">
                {!selectedCaptures.length && (
                  <div className="record-empty-day">
                    <p>A quiet day.</p>
                    <span>Choose a green square to see another day.</span>
                  </div>
                )}
                <ul className="record-log">
                  {selectedCaptures.map((e) => (
                    <li
                      key={e.id}
                      className={e.undone ? "record-undone" : undefined}
                    >
                      <p className="record-filed">{e.filed || e.said}</p>
                      {e.differs && (
                        <p className="record-said">
                          <span>said</span> {e.said}
                        </p>
                      )}
                      {e.undone && e.said && (
                        <button
                          className="record-restore"
                          onClick={() => onRestore(e.said)}
                        >
                          Say it again
                        </button>
                      )}
                      <p className="record-meta">
                        {e.kind} · {e.undone && "undone · "}
                        {(() => {
                          const home = e.targetId
                            ? threads.find((t) => t.id === e.targetId)
                            : undefined;
                          return home ? (
                            <>
                              in{" "}
                              <button
                                className="record-home"
                                onClick={() => onOpenThread(home.id)}
                              >
                                {home.name}
                              </button>{" "}
                              ·{" "}
                            </>
                          ) : null;
                        })()}
                        {fmt(e.at)}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {rules.length > 0 && (
            <div className="record-section">
              <button
                className="record-disclosure"
                onClick={() => setShowRules((value) => !value)}
                aria-expanded={showRules}
                aria-label={`${showRules ? "Hide" : "Show"} sorting preferences`}
              >
                <span className="record-disclosure-title">
                  Sorting preferences
                </span>
                <span className="record-disclosure-meta">
                  {rules.length === 1
                    ? rules[0].enabled
                      ? "on"
                      : "off"
                    : `${rules.filter((rule) => rule.enabled).length} on`}
                </span>
                {showRules ? (
                  <ChevronUp size={21} strokeWidth={1.7} />
                ) : (
                  <ChevronDown size={21} strokeWidth={1.7} />
                )}
              </button>

              {showRules && (
                <div className="record-disclosure-body">
                  <ul className="learned-list">
                    {rules.map((rule) => (
                      <li key={rule.key} className={rule.enabled ? "" : "off"}>
                        <span className="learned-text">{rule.text}</span>
                        <button
                          className={"rule-switch" + (rule.enabled ? " on" : "")}
                          role="switch"
                          aria-checked={rule.enabled}
                          aria-label={rule.text}
                          onClick={() =>
                            onToggleRule(rule.key, !rule.enabled)
                          }
                        >
                          <span />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}

    </div>
  );
}

function SettingsDisclosure({
  title,
  meta,
  open,
  onToggle,
  children,
}: {
  title: string;
  meta: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="settings-section">
      <button
        className="record-disclosure"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} ${title}`}
      >
        <span className="record-disclosure-title">{title}</span>
        <span className="record-disclosure-meta">{meta}</span>
        {open ? (
          <ChevronUp size={21} strokeWidth={1.7} />
        ) : (
          <ChevronDown size={21} strokeWidth={1.7} />
        )}
      </button>
      {open && (
        <div className="record-disclosure-body settings-body">{children}</div>
      )}
    </div>
  );
}

export function SettingsScreen({
  principles,
  counts,
  onBack,
  onToggle,
  onAdd,
  onDelete,
  onExport,
  onRestore,
  snapshotDaysList,
  onRestoreSnapshot,
  onCopyBoard,
  onImportIntent,
  onLogout,
  ioNote,
  sync,
  onSyncNow,
  onOpenRecord,
  ledgerCount,
}: {
  principles: Principle[];
  counts: { actions: number; threads: number; intentions: number };
  onBack: () => void;
  onToggle: (id: string) => void;
  onAdd: (name: string, description: string) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  onRestore: (file: File) => void;
  /** The days this device kept a copy of the board, newest first. */
  snapshotDaysList: string[];
  onRestoreSnapshot: (day: string) => void;
  /** The cold start: everything, for an agent that knows nothing. */
  onCopyBoard: () => void;
  onImportIntent: (file: File) => void;
  onLogout: () => void;
  ioNote: IoNote;
  sync: { ok: boolean; at: number; note?: string } | null;
  onSyncNow: () => void;
  /** The signpost to The record — the screen itself lives off the masthead,
      but Settings is where people go looking, especially on phones where
      the header count is hidden. */
  onOpenRecord: () => void;
  ledgerCount: number;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [openSection, setOpenSection] = useState<
    "data" | "restore" | "agent" | "principles" | "support" | null
  >(null);
  const [reporting, setReporting] = useState(false);
  const activePrinciples = principles.filter((p) => p.enabled).length;
  const itemCount = counts.actions + counts.threads + counts.intentions;
  const toggleSection = (section: NonNullable<typeof openSection>) =>
    setOpenSection((current) => (current === section ? null : section));

  return (
    <div>
      <button className="back" onClick={onBack}>
        ← back
      </button>

      <div className="tname" style={{ fontSize: 26, marginBottom: 18 }}>
        Settings
      </div>

      <div className="settings-list">
        <div className="settings-section">
          <button
            className="record-disclosure"
            onClick={onOpenRecord}
            aria-label="Open The Record"
          >
            <span className="record-disclosure-title">The Record</span>
            <span className="record-disclosure-meta">{ledgerCount} said</span>
            <ChevronRight size={21} strokeWidth={1.7} />
          </button>
        </div>

        <SettingsDisclosure
          title="Data and sync"
          meta={
            PLAYGROUND
              ? `${itemCount} item${itemCount === 1 ? "" : "s"}`
              : sync
                ? sync.ok
                  ? "synced"
                  : "offline"
                : "not synced"
          }
          open={openSection === "data"}
          onToggle={() => toggleSection("data")}
        >
          <div className="settings-group">
            <h4 className="settings-group-title">Backup</h4>
            <p className="settings-copy">
              {counts.actions} action{counts.actions === 1 ? "" : "s"},{" "}
              {counts.threads} thread{counts.threads === 1 ? "" : "s"}, and{" "}
              {counts.intentions} intention
              {counts.intentions === 1 ? "" : "s"}. Includes pictures and
              history.
            </p>
            <button className="capture-btn" onClick={onExport}>
              Download backup
            </button>
          </div>

          {!PLAYGROUND && (
            <div className="settings-group">
              <h4 className="settings-group-title">Devices</h4>
              <div className="settings-status">
                <span
                  className={
                    "sync-dot" + (sync ? (sync.ok ? " on" : " bad") : "")
                  }
                />
                <span>
                  {sync
                    ? sync.ok
                      ? "Synced " + fmt(sync.at) + "."
                      : sync.note + "."
                    : "This device has not reached the hub yet."}
                </span>
              </div>
              <button className="ghost" onClick={onSyncNow}>
                Sync now
              </button>
            </div>
          )}
          <Note note={ioNote} />
        </SettingsDisclosure>

        <SettingsDisclosure
          title="Restore"
          meta={
            snapshotDaysList.length
              ? `${snapshotDaysList.length} daily ${
                  snapshotDaysList.length === 1 ? "copy" : "copies"
                }`
              : "backup · import"
          }
          open={openSection === "restore"}
          onToggle={() => toggleSection("restore")}
        >
          {snapshotDaysList.length > 0 && (
            <div className="settings-group">
              <h4 className="settings-group-title">Go back a day</h4>
              <p className="settings-copy">
                Adds missing items from a daily copy. It never removes what is
                here now.
              </p>
              <div className="snap-row">
                {snapshotDaysList.map((day) => (
                  <button
                    key={day}
                    className="ghost snap-day"
                    onClick={() => onRestoreSnapshot(day)}
                  >
                    {snapshotLabel(day)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="settings-group">
            <h4 className="settings-group-title">Capture backup</h4>
            <p className="settings-copy">
              Adds missing data and pictures. Uploading the same backup twice
              changes nothing the second time.
            </p>
            <FileButton label="Upload a Capture backup" onFile={onRestore} />
          </div>

          <div className="settings-group">
            <h4 className="settings-group-title">Intentions</h4>
            <p className="settings-copy">
              Imports intentions from the old Intent app without duplicating
              existing ones.
            </p>
            <FileButton label="Upload an Intent backup" onFile={onImportIntent} />
          </div>
          <Note note={ioNote} />
        </SettingsDisclosure>

        <SettingsDisclosure
          title="Agent handoff"
          meta="full context"
          open={openSection === "agent"}
          onToggle={() => toggleSection("agent")}
        >
          <div className="settings-group">
            <p className="settings-copy">
              Copies every thread, where it stands, and its related actions.
              Use this when an agent has no Capture context yet.
            </p>
            <button className="ghost" onClick={onCopyBoard}>
              Copy the whole board
            </button>
          </div>
          <Note note={ioNote} />
        </SettingsDisclosure>

        <SettingsDisclosure
          title="Principles"
          meta={
            activePrinciples === principles.length
              ? `all ${principles.length} on`
              : `${activePrinciples} of ${principles.length} on`
          }
          open={openSection === "principles"}
          onToggle={() => toggleSection("principles")}
        >
          <p className="settings-copy">
            These shape intention wording only. Nothing else in Capture uses
            them.
          </p>
          <ul className="settings-principles">
            {principles.map((principle) => (
              <li key={principle.id} className={principle.enabled ? "" : "off"}>
                <span className="settings-principle-copy">
                  <span className="settings-principle-name">{principle.name}</span>
                  <span className="settings-principle-description">
                    {principle.description}
                  </span>
                  {!principle.builtin && (
                    <button
                      className="settings-principle-delete"
                      onClick={() => onDelete(principle.id)}
                    >
                      Delete
                    </button>
                  )}
                </span>
                <button
                  className={
                    "rule-switch" + (principle.enabled ? " on" : "")
                  }
                  role="switch"
                  aria-checked={principle.enabled}
                  aria-label={principle.name}
                  onClick={() => onToggle(principle.id)}
                >
                  <span />
                </button>
              </li>
            ))}
          </ul>

          <div className="settings-group settings-add-principle">
            <h4 className="settings-group-title">Add a principle</h4>
            <div className="int-add settings-form">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                aria-label="Principle name"
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What it means"
                aria-label="Principle description"
              />
              <button
                className="ghost"
                disabled={!name.trim() || !description.trim()}
                onClick={() => {
                  onAdd(name.trim(), description.trim());
                  setName("");
                  setDescription("");
                }}
              >
                Add principle
              </button>
            </div>
          </div>
        </SettingsDisclosure>

        <SettingsDisclosure
          title="Support and session"
          meta="help · logout"
          open={openSection === "support"}
          onToggle={() => toggleSection("support")}
        >
          <div className="settings-group">
            <h4 className="settings-group-title">Caught a bug?</h4>
            <p className="settings-copy">
              Say what happened. No GitHub account is needed.
            </p>
            <button className="ghost" onClick={() => setReporting(true)}>
              Report a bug
            </button>
            {reporting && (
              <ReportBugForm onClose={() => setReporting(false)} />
            )}
          </div>

          <div className="settings-group">
            <h4 className="settings-group-title">Session</h4>
            <p className="settings-copy">Ends this login on this device.</p>
            <button className="ghost warn" onClick={onLogout}>
              Log out
            </button>
          </div>
        </SettingsDisclosure>
      </div>
    </div>
  );
}
