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
  rules,
  onClearRule,
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
  /* The bounded personal model: what the sort engine has learned to expect,
      each with a way to forget it. */
  rules: LearnedRule[];
  onClearRule: (key: string) => void;
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
        <h4 className="int-label">Keep devices in step</h4>
        <p className="int-note">
          Edits, deletes and moves flow between this device and the sync hub
          automatically — every change is pushed a moment after you make it,
          and fresh state is pulled every few seconds while this tab is open.
          If two devices change the same thing, the newer edit wins and
          nothing is silently lost. Tap Sync now to force a pull + push.
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

      <div className="int-block">
        <h4 className="int-label">What Capture has learned</h4>
        <p className="int-note">
          From the suggestions you accept or dismiss. The sort engine treats
          these as gentle tendencies, not orders — and you can forget any of
          them whenever you like. Forgetting is remembered on this device.
        </p>
        {rules.length === 0 ? (
          <p className="cap-hint" style={{ marginTop: 8 }}>
            Nothing yet. As you accept or dismiss suggestions — merges, moves,
            duplicates — the patterns will show up here.
          </p>
        ) : (
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
        )}
      </div>

      <div className="int-block">
        <h4 className="int-label">Restore a capture backup</h4>
        <p className="int-note">
          Adds anything missing, matched by id. Never overwrites what is
          already here, so restoring twice is safe.
        </p>
        <FileButton label="Upload a capture backup" onFile={onRestore} />
      </div>

      <div className="int-block">
        <h4 className="int-label">Bring intentions across</h4>
        <p className="int-note">
          A backup exported from the old intent app. Matched by id, so
          importing twice adds nothing the second time.
        </p>
        <FileButton label="Upload an intent backup" onFile={onImportIntent} />
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

      <div className="int-block">
        <h4 className="int-label">Session</h4>
        <p className="int-note">
          Ends this login on this device. You&apos;ll be asked for the password
          again next time.
        </p>
        <button className="ghost warn" onClick={onLogout}>
          Log out
        </button>
      </div>
    </div>
  );
}
