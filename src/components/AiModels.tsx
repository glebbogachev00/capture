"use client";

import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useEffect, useState } from "react";
import { KEY_PROVIDERS, type AiConnection, type KeyProvider } from "@/lib/aiProviders";
import { t } from "@/lib/i18n";
import { uid } from "@/lib/model";
import { clearLegacyOwnKey, readLegacyOwnKey } from "@/lib/ownAiKey";
import { getDocumentLifetime, ownedFetch as fetch } from "@/lib/ownership";

type View = { mode: "local" | "cloud"; connections: AiConnection[] };
type Row = { id: string; model: string; key?: string };
type State = "loading" | "ready" | "needs-cloud" | "signed-out" | "unavailable";

const json = { "content-type": "application/json" };

/**
 * The AI a person connected, as one list: the top one answers first, the
 * next ones if it fails. Paste any supported key to add one; the model comes
 * from what that key can use. Saved where every device reads it, never shown
 * back except for its last four characters.
 */
export function AiModels({ onCount }: { onCount?: (count: number) => void }) {
  const [state, setState] = useState<State>("loading");
  const [view, setView] = useState<View | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<Record<string, string>>({});
  const count = view?.connections.length;
  useEffect(() => {
    if (count !== undefined) onCount?.(count);
  }, [count, onCount]);

  const apply = (next: View) => setView(next);

  const save = async (rows: Row[]) => {
    const response = await fetch("/api/ai-settings", { method: "PUT", headers: json, body: JSON.stringify({ connections: rows }) });
    if (!response.ok) throw new Error("not saved");
    apply(await response.json());
  };

  const rowsOf = (connections: AiConnection[]): Row[] => connections.map(({ id, model }) => ({ id, model }));

  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const response = await fetch("/api/ai-settings");
        if (stopped) return;
        if (response.status === 401) return setState("signed-out");
        if (response.status === 402) return setState("needs-cloud");
        if (!response.ok) return setState("unavailable");
        const loaded = (await response.json()) as View;
        if (stopped) return;
        apply(loaded);
        setState("ready");
        /* A key an earlier version kept on this device joins the list once. */
        const owner = getDocumentLifetime().owner;
        const legacy = readLegacyOwnKey(owner);
        if (owner && legacy && !loaded.connections.length) {
          const checked = await fetch("/api/ai-settings/models", { method: "POST", headers: json, body: JSON.stringify({ key: legacy }) });
          if (checked.ok) {
            const { defaultModel } = (await checked.json()) as { defaultModel: string };
            await save([{ id: uid(), model: defaultModel, key: legacy }]);
          }
          clearLegacyOwnKey(owner);
        }
      } catch {
        if (!stopped) setState("unavailable");
      }
    })();
    return () => { stopped = true; };
    // Loads once; `save` and `apply` only touch state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await work();
    } catch {
      setNote(t("Couldn't save that. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const add = () => run(async () => {
    const key = draft.trim();
    const response = await fetch("/api/ai-settings/models", { method: "POST", headers: json, body: JSON.stringify({ key }) });
    const out = (await response.json()) as { error?: string; provider?: KeyProvider; models?: string[]; defaultModel?: string };
    if (!response.ok || !out.defaultModel) {
      const name = out.provider ? KEY_PROVIDERS[out.provider].name : "";
      setNote(out.error === "unrecognised key"
        ? t("That isn't a key Capture recognises: OpenAI, Claude, Gemini, OpenRouter, Groq or Cerebras.")
        : out.error === "refused" ? t("{provider} refused that key.", { provider: name })
        : out.error === "unreachable" ? t("Couldn't reach {provider}. Try again.", { provider: name })
        : t("Couldn't check that key."));
      return;
    }
    const id = uid();
    await save([...rowsOf(view!.connections), { id, model: out.defaultModel, key }]);
    setModels((current) => ({ ...current, [id]: out.models ?? [] }));
    setDraft("");
  });

  const move = (index: number, step: number) => run(async () => {
    const rows = rowsOf(view!.connections);
    const [row] = rows.splice(index, 1);
    rows.splice(index + step, 0, row);
    await save(rows);
  });

  const remove = (id: string) => run(() => save(rowsOf(view!.connections).filter((row) => row.id !== id)));

  const commitModel = (id: string) => {
    const model = editing[id]?.trim();
    setEditing((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    const current = view!.connections.find((row) => row.id === id);
    if (!model || !current || model === current.model) return;
    void run(() => save(rowsOf(view!.connections).map((row) => (row.id === id ? { ...row, model } : row))));
  };

  const loadModels = async (id: string) => {
    if (models[id]) return;
    const response = await fetch("/api/ai-settings/models", { method: "POST", headers: json, body: JSON.stringify({ id }) });
    if (response.ok) {
      const { models: found } = (await response.json()) as { models: string[] };
      setModels((current) => ({ ...current, [id]: found }));
    }
  };

  if (state === "loading") return <p className="settings-copy">{t("Checking your AI models…")}</p>;
  if (state === "needs-cloud") return <p className="settings-copy">{t("Connecting your own AI is part of Capture Cloud.")}</p>;
  if (state === "signed-out") return <p className="settings-copy">{t("Sign in to Capture Cloud to connect your own AI.")}</p>;
  if (state === "unavailable" || !view) return <p className="settings-copy">{t("Your own AI can't be connected here yet.")}</p>;

  return (
    <div className="ai-models">
      <p className="settings-copy">
        {view.mode === "cloud"
          ? t("Used instead of Cloud's AI allowance, top first. Saved to your account, so every device uses them.")
          : t("Used first, top to bottom; Capture's own AI answers if they all fail. Saved on this Capture, so every device uses them.")}
      </p>
      {!!view.connections.length && (
        <ol className="ai-model-list">
          {view.connections.map((row, index) => {
            const name = KEY_PROVIDERS[row.provider].name;
            return (
              <li key={row.id} className="ai-model-row">
                <span className="ai-model-name">
                  {name} <small>…{row.hint}</small>
                </span>
                <input
                  className="ai-model-pick"
                  list={`ai-models-${row.id}`}
                  value={editing[row.id] ?? row.model}
                  aria-label={t("Model for {provider}", { provider: name })}
                  spellCheck={false}
                  onFocus={() => void loadModels(row.id)}
                  onChange={(event) => setEditing((current) => ({ ...current, [row.id]: event.target.value }))}
                  onBlur={() => commitModel(row.id)}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                />
                <datalist id={`ai-models-${row.id}`}>
                  {(models[row.id] ?? []).map((model) => <option key={model} value={model} />)}
                </datalist>
                <span className="ai-model-tools">
                  <button className="icon-btn" disabled={busy || index === 0} onClick={() => void move(index, -1)} aria-label={t("Use {provider} sooner", { provider: name })}>
                    <ArrowUp size={16} strokeWidth={1.7} />
                  </button>
                  <button className="icon-btn" disabled={busy || index === view.connections.length - 1} onClick={() => void move(index, 1)} aria-label={t("Use {provider} later", { provider: name })}>
                    <ArrowDown size={16} strokeWidth={1.7} />
                  </button>
                  <button className="icon-btn" disabled={busy} onClick={() => void remove(row.id)} aria-label={t("Remove {provider}", { provider: name })}>
                    <X size={16} strokeWidth={1.7} />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <div className="own-key-row">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={t("Paste an API key")}
          aria-label={t("Paste an API key")}
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setNote(null); }}
          onKeyDown={(event) => { if (event.key === "Enter" && draft.trim() && !busy) void add(); }}
        />
        <button className="ghost" onClick={() => void add()} disabled={busy || !draft.trim()}>
          {busy ? t("Checking…") : t("Add")}
        </button>
      </div>
      {note && <p className="cloud-action-note" role="status">{note}</p>}
    </div>
  );
}
