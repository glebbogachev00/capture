"use client";

/* ============================================================
   INTENTIONS — carried over from the standalone intent app.

   An intention is declared, not closed. It is written in present
   tense as already true; its recommended actions are things you
   do BECAUSE it is already so, not steps toward making it so.
   That is why none of this has a checkbox or a shelf life: an
   action is finished, an intention is inhabited.
   ============================================================ */

import { useState } from "react";
import { type Intention, type Principle, fmt, pad } from "@/lib/model";

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
              ×
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
  onRefine,
  onSave,
  onDiscard,
}: {
  draft: Draft;
  busy: boolean;
  onChange: (d: Draft) => void;
  onRefine: (feedback: string) => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const [feedback, setFeedback] = useState("");
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

      <div className="int-block">
        <h4 className="int-label">Refine</h4>
        <div className="int-add">
          <input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && feedback.trim()) {
                onRefine(feedback.trim());
                setFeedback("");
              }
            }}
            placeholder="Say what to change"
            aria-label="Refinement direction"
          />
          <button
            className="ghost"
            disabled={busy || !feedback.trim()}
            onClick={() => {
              onRefine(feedback.trim());
              setFeedback("");
            }}
          >
            Rewrite
          </button>
        </div>
      </div>

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
  busy,
  onBack,
  onChange,
  onRefine,
  onCopy,
  onDelete,
}: {
  intention: Intention;
  busy: boolean;
  onBack: () => void;
  onChange: (next: Intention) => void;
  onRefine: (feedback: string) => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState("");
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
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="2.5" y="2.5" width="8" height="8" stroke="currentColor" strokeWidth="1.4" />
              <rect x="5.5" y="5.5" width="8" height="8" stroke="currentColor" strokeWidth="1.4" />
            </svg>
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
            ···
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
        <div className="shelf" style={{ marginBottom: 18 }}>
          <span className="cap-hint" style={{ flex: "1 1 100%" }}>
            Delete intention {pad(intention.number)}? This cannot be undone.
          </span>
          <button className="warn" onClick={onDelete}>
            Delete for good
          </button>
          <button onClick={() => setConfirming(false)}>Keep it</button>
        </div>
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

      <div className="int-block">
        <h4 className="int-label">Refine</h4>
        <div className="int-add">
          <input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && feedback.trim()) {
                onRefine(feedback.trim());
                setFeedback("");
              }
            }}
            placeholder="Say what to change"
            aria-label="Refinement direction"
          />
          <button
            className="ghost"
            disabled={busy || !feedback.trim()}
            onClick={() => {
              onRefine(feedback.trim());
              setFeedback("");
            }}
          >
            Rewrite
          </button>
        </div>
      </div>

      {intention.rawInput &&
        intention.rawInput !== intention.expandedIntention && (
          <div className="int-block">
            <h4 className="int-label">As you said it</h4>
            <p className="int-raw">{intention.rawInput}</p>
          </div>
        )}
    </div>
  );
}

/**
 * A file button that works on iOS.
 *
 * A `hidden` (display:none) input is the usual trick, but Safari will not
 * always open the picker when its label is tapped. Rendering the input and
 * clipping it to a pixel keeps it a real, hit-testable control.
 */
function FileButton({
  label,
  onFile,
}: {
  label: string;
  onFile: (file: File) => void;
}) {
  return (
    <label className="ghost int-file">
      {label}
      <input
        type="file"
        accept="application/json,.json"
        className="clipped"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </label>
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
  ioNote,
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
  ioNote: IoNote;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  return (
    <div>
      <button className="back" onClick={onBack}>
        ← back
      </button>

      <div className="tname" style={{ fontSize: 26, marginBottom: 18 }}>
        Settings
      </div>

      <div className="int-block">
        <h4 className="int-label">Back up everything</h4>
        <p className="int-note">
          All of it lives in this browser and nowhere else — {counts.actions}{" "}
          action{counts.actions === 1 ? "" : "s"}, {counts.threads} thread
          {counts.threads === 1 ? "" : "s"}, {counts.intentions} intention
          {counts.intentions === 1 ? "" : "s"}. Clearing site data would take
          the lot. Pictures are left out to keep the file small.
        </p>
        <div className="int-add">
          <button className="capture-btn" onClick={onExport}>
            Download backup
          </button>
        </div>
      </div>

      <div className="int-block">
        <h4 className="int-label">Restore a capture backup</h4>
        <p className="int-note">
          Adds anything missing, matched by id. Never overwrites what is
          already here, so restoring twice is safe.
        </p>
        <FileButton label="Choose capture backup" onFile={onRestore} />
      </div>

      <div className="int-block">
        <h4 className="int-label">Bring intentions across</h4>
        <p className="int-note">
          A backup exported from the old intent app. Matched by id, so
          importing twice adds nothing the second time.
        </p>
        <FileButton label="Choose intent backup" onFile={onImportIntent} />
      </div>

      <Note note={ioNote} />

      <div className="int-block">
        <h4 className="int-label">Principles</h4>
        <p className="int-note">
          Applied silently to every intention the engine writes. They never
          appear in the result — they shape it.{" "}
          {principles.filter((p) => p.enabled).length} of {principles.length}{" "}
          active.
        </p>
      </div>

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
    </div>
  );
}
