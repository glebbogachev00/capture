"use client";

/* ============================================================
   INTENTIONS — carried over from the standalone intent app.

   An intention is declared, not closed. It is written in present
   tense as already true; its recommended actions are things you
   do BECAUSE it is already so, not steps toward making it so.
   That is why none of this has a checkbox or a shelf life: an
   action is finished, an intention is inhabited.
   ============================================================ */

import { useRef, useState } from "react";
import { Copy, X, MoreHorizontal } from "lucide-react";
import { type Intention, type Principle, type Thread, fmt, pad } from "@/lib/model";
import { snapshotLabel } from "@/lib/snapshots";
import type { LearnedRule } from "@/lib/rules";
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
  onBack,
  rules,
  onClearRule,
  threads,
  onOpenThread,
  onRestore,
  wrap,
  onWrapSeen,
}: {
  ledger: CaptureEntry[];
  now: number;
  onBack: () => void;
  /* Yesterday's reading. It lives here rather than on the board: the record
     is already the place days are looked back on, and the heat map right
     below says which days were worth looking at. On the board it was
     clutter — a statement wedged into a stack of tools. */
  wrap?: DayWrap | null;
  onWrapSeen?: () => void;
  /* The bounded personal model: what the sorter has come to expect, each
     with a way to forget it. */
  rules: LearnedRule[];
  onClearRule: (key: string) => void;
  /** The threads used for both landing names and the recurring profile reading. */
  threads: Thread[];
  onOpenThread: (id: string) => void;
  /** Put an undone capture's words back in the composer — the way back for
      anything discarded: said again, sorted fresh. */
  onRestore: (said: string) => void;
}) {
  const [openWrap, setOpenWrap] = useState(false);
  /* The page's real subject: ONE day. It opens on today, and any cell in
     the grid is a way to a different day — "the point is the story on the
     given day", not a feed of everything ever said. */
  const [day, setDay] = useState(() => dayKey(now));
  const stats = recordStats(ledger);
  const grid = heatGrid(ledger, now);
  const months = monthLabels(grid);
  const caught = caughtWords(ledger);
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
        <div className="empty">
          <p className="big">Nothing on the record yet.</p>
          <p>
            Every capture lands here — what you said, and what became of it.
          </p>
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
                        onClick={() => setDay(cell.day)}
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

          {/* The evidence — for the chosen day only, oldest first, the way
              the day was lived. What landed is shown first, because that is
              what you live with; what you actually said sits under it, and
              only when the engine changed the words. */}
          <div className="section-label" style={{ cursor: "default" }}>
            {day === dayKey(now) ? "Today" : dayName(day)} — what you said,
            and what became of it
          </div>
          {!dayCaptures(ledger, day).length && (
            <p className="record-caption">
              Nothing said this day. Tap a green cell above for a day that
              has a story.
            </p>
          )}
          <ul className="record-log">
            {dayCaptures(ledger, day).map((e) => (
              <li key={e.id} className={e.undone ? "record-undone" : undefined}>
                <p className="record-filed">{e.filed || e.said}</p>
                {e.differs && (
                  <p className="record-said">
                    <span>said</span> {e.said}
                  </p>
                )}
                {e.undone && e.said && (
                  /* The way back. An undone entry is a thought that was
                     said and then not kept — restoring it is just saying it
                     again, so that is literally what the button does: the
                     words return to the composer and sort fresh. No new
                     object kinds, no resurrection machinery. */
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
                    /* The connection, where it exists: which thread this
                       capture landed on, and a way to go there. A gone
                       thread names nothing rather than a dead link. */
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
        </>
      )}

          {/* What the engine has picked up from the suggestions you took or
              waved off. It belongs here rather than in Settings: this is the
              screen about what Capture knows, and Settings is for the knobs.
              Nothing is shown until a tendency actually forms — an empty
              explainer is just a paragraph asking to be skipped. */}
      {rules.length > 0 && (
            <>
              <div className="section-label" style={{ cursor: "default" }}>
                What it has learned about your filing
              </div>
              <ul className="learned-list">
                {rules.map((r) => (
                  <li key={r.key}>
                    <span className="learned-body">
                      <span className="learned-text">{r.text}</span>
                      <span className="learned-signal">
                        {r.accepts} accepted · {r.dismisses} dismissed
                      </span>
                    </span>
                    <button
                      className="ghost warn"
                      onClick={() => onClearRule(r.key)}
                      aria-label={"Forget: " + r.text}
                    >
                      Forget
                    </button>
                  </li>
                ))}
              </ul>
              <p className="record-caption" style={{ marginBottom: 18 }}>
                gentle tendencies the sorter weighs, never orders — forgetting
                is remembered on this device
              </p>
            </>
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
  const [showPrinciples, setShowPrinciples] = useState(false);
  const [reporting, setReporting] = useState(false);

  return (
    <div>
      <button className="back" onClick={onBack}>
        ← back
      </button>

      <div className="tname" style={{ fontSize: 26, marginBottom: 18 }}>
        Settings
      </div>

      <button
        className="section-label"
        style={{ margin: "0 0 14px" }}
        onClick={onOpenRecord}
      >
        The record · {ledgerCount} said · twelve weeks of days
      </button>

      <div className="int-block">
        <h4 className="int-label">Back up everything</h4>
        <p className="int-note">
          In this browser and nowhere else: {counts.actions} action
          {counts.actions === 1 ? "" : "s"}, {counts.threads} thread
          {counts.threads === 1 ? "" : "s"}, {counts.intentions} intention
          {counts.intentions === 1 ? "" : "s"}. Clearing site data takes them.
          Pictures are left out.
        </p>
        <div className="int-add">
          <button className="capture-btn" onClick={onExport}>
            Download backup
          </button>
        </div>
      </div>

      {!PLAYGROUND && (
        <div className="int-block">
          <h4 className="int-label">Keep devices in step</h4>
          <p className="int-note">
            Automatic, both ways. If two devices change the same thing, the
            newer edit wins.
          </p>
          <div className="int-add">
            <span
              className={
                "sync-dot" + (sync ? (sync.ok ? " on" : " bad") : "")
              }
            />
            <span className="cap-hint" style={{ flex: 1 }}>
              {sync
                ? sync.ok
                  ? "Synced " + fmt(sync.at) + "."
                  : sync.note + "."
                : "This device hasn't reached the hub yet."}
            </span>
            <button className="ghost" onClick={onSyncNow}>
              Sync now
            </button>
          </div>
        </div>
      )}

      {/* The rollback sync cannot give you: the hub mirrors this board,
          damage included, so a copy from before the damage has to live
          here. Written once a day, seven kept. */}
      {snapshotDaysList.length > 0 && (
        <div className="int-block">
          <h4 className="int-label">Go back a day</h4>
          <p className="int-note">
            This device keeps a copy of the board from each of the last
            {" "}
            {snapshotDaysList.length === 1
              ? "day"
              : `${snapshotDaysList.length} days`}
            . Restoring adds back what is missing; it never removes
            anything.
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

      <div className="int-block">
        <h4 className="int-label">Hand the whole board to an agent</h4>
        <p className="int-note">
          Every thread with where it stands and the actions that belong
          with it. The record hands over only what is new; this is the
          cold start.
        </p>
        <button className="ghost" onClick={onCopyBoard}>
          Copy the whole board
        </button>
      </div>

      <div className="int-block">
        <h4 className="int-label">Restore a capture backup</h4>
        <p className="int-note">
          Adds what is missing, matched by id. Restoring twice is safe.
        </p>
        <FileButton label="Upload a capture backup" onFile={onRestore} />
      </div>

      <div className="int-block">
        <h4 className="int-label">Bring intentions across</h4>
        <p className="int-note">
          From the old intent app. Matched by id, so twice is safe.
        </p>
        <FileButton label="Upload an intent backup" onFile={onImportIntent} />
      </div>

      <Note note={ioNote} />

      <div className="int-block">
        <h4 className="int-label">Principles</h4>
        <p className="int-note">
          Shape how an <b>intention</b> is written. Nothing else sees them.{" "}
          {principles.filter((p) => p.enabled).length} of {principles.length}{" "}
          active.
        </p>
        {/* Fifteen of them, and they touch one rare flow — so the list is
            folded away by default rather than filling the screen. */}
        <button
          className="section-label"
          style={{ margin: "10px 0 0" }}
          onClick={() => setShowPrinciples((v) => !v)}
          aria-expanded={showPrinciples}
        >
          {showPrinciples ? "▾" : "▸"} {showPrinciples ? "Hide" : "Show"} the
          fifteen
        </button>
      </div>

      {showPrinciples && (
      <ul className="prin-list">
        {principles.map((p) => (
          <li key={p.id} className={p.enabled ? "" : "off"}>
            <button
              className="prin-toggle"
              onClick={() => onToggle(p.id)}
              aria-label={(p.enabled ? "Disable " : "Enable ") + p.name}
            >
              <span className={"prin-dot" + (p.enabled ? " on" : "")} />
              <span className="prin-body">
                <span className="prin-name">{p.name}</span>
                <span className="prin-desc">{p.description}</span>
              </span>
            </button>
            {!p.builtin && (
              <button className="ghost warn" onClick={() => onDelete(p.id)}>
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
      )}

      {showPrinciples && (
      <div className="int-block">
        <h4 className="int-label">Add a principle</h4>
        <div className="int-add" style={{ flexDirection: "column" }}>
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
      )}

      {/* The bottom-of-the-board line is the door you find when something
          has just gone wrong; this is the one you go looking for later,
          when you have finally had enough of it. Same form either way. */}
      <div className="int-block">
        <h4 className="int-label">Caught a bug?</h4>
        <p className="int-note">
          Say what happened. No GitHub account needed.
        </p>
        <button className="ghost" onClick={() => setReporting(true)}>
          Report a bug
        </button>
      </div>
      {reporting && (
        <ReportBugForm onClose={() => setReporting(false)} />
      )}

      <div className="int-block">
        <h4 className="int-label">Session</h4>
        <p className="int-note">Ends this login on this device.</p>
        <button className="ghost warn" onClick={onLogout}>
          Log out
        </button>
      </div>
    </div>
  );
}
