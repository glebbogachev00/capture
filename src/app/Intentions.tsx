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
import { type Intention, type Principle, fmt, pad } from "@/lib/model";
import type { LearnedRule } from "@/lib/rules";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { ReportBugForm } from "@/components/ReportBug";
import { PLAYGROUND } from "@/lib/playground";
import type { CaptureEntry } from "@/lib/ledger";
import {
  busiestDay,
  heatGrid,
  recordRun,
  monthLabels,
  recentCaptures,
  recordStats,
} from "@/lib/record";

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
}: {
  draft: Draft;
  busy: boolean;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onDiscard: () => void;
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
}: {
  ledger: CaptureEntry[];
  now: number;
  onBack: () => void;
  /* The bounded personal model: what the sorter has come to expect, each
     with a way to forget it. */
  rules: LearnedRule[];
  onClearRule: (key: string) => void;
}) {
  const stats = recordStats(ledger);
  const grid = heatGrid(ledger, now);
  const months = monthLabels(grid);
  const busiest = busiestDay(grid);
  const run = recordRun(grid);
  const dayName = (day: string) =>
    new Date(day + "T12:00:00").toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
    });
  return (
    <div>
      <button className="back" onClick={onBack}>
        ← capture
      </button>

      <div className="tname" style={{ fontSize: 26, marginBottom: 10 }}>
        The record
      </div>

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

          <div className="record-frame">
            <div className="record-grid">
              {grid.map((week) => (
                <div className="record-col" key={week[0].day}>
                  {week.map((cell) => (
                    <i
                      key={cell.day}
                      className={"record-cell l" + cell.level}
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
          </div>

          <p className="record-caption">
            the last twelve weeks, day by day
            {busiest && busiest.count > 1
              ? ` — fullest on ${dayName(busiest.day)}, ${busiest.count} said`
              : ""}
          </p>
          {/* A second line only when there is something to be pleased about:
              a run of one day is just a day, and a grid with nothing on it
              should stay quiet rather than congratulate an empty week. */}
          {run.longest > 1 && (
            <p className="record-caption record-run">
              {run.marked} days marked · longest run {run.longest} in a row
            </p>
          )}

          {/* The evidence. What landed is shown first, because that is what
              you live with; what you actually said sits under it, and only
              when the engine changed the words. */}
          <div className="section-label" style={{ cursor: "default" }}>
            What you said, and what became of it
          </div>
          <ul className="record-log">
            {recentCaptures(ledger).map((e) => (
              <li key={e.id}>
                <p className="record-filed">{e.filed || e.said}</p>
                {e.differs && (
                  <p className="record-said">
                    <span>said</span> {e.said}
                  </p>
                )}
                <p className="record-meta">
                  {e.kind} · {fmt(e.at)}
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
