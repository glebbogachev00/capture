"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getDocumentLifetime, resumeOfflineIdentity } from "@/lib/ownership";
import styles from "./OfflineSettings.module.css";

// A device-local UX choice, never authority. Each account answers separately.
const CHOICE_PREFIX = "capture:offline-invitation:v1:";
const CHOICE_EVENT = "capture:offline-choice";
function readChoice(owner: string | null) {
  try { return !!owner && localStorage.getItem(CHOICE_PREFIX + owner) === "answered"; }
  catch { return false; }
}
function rememberChoice(owner: string | null) {
  if (!owner) return;
  try { localStorage.setItem(CHOICE_PREFIX + owner, "answered"); }
  catch { /* The current visit can still dismiss when storage is blocked. */ }
  window.dispatchEvent(new Event(CHOICE_EVENT));
}
const serverSnapshot = () => "checking:false:false";
function useOfflineChoice() {
  const [lifetime] = useState(getDocumentLifetime);
  const subscribe = useCallback((notify: () => void) => {
    const stop = lifetime.subscribe(notify);
    window.addEventListener("storage", notify);
    window.addEventListener(CHOICE_EVENT, notify);
    return () => { stop(); window.removeEventListener("storage", notify); window.removeEventListener(CHOICE_EVENT, notify); };
  }, [lifetime]);
  const snapshot = useCallback(() => {
    const canEnable = lifetime.snapshot() === "active" && Date.now() < lifetime.expiresAt && navigator.onLine;
    return `${canEnable}:${!!lifetime.owner && resumeOfflineIdentity()?.owner === lifetime.owner}:${readChoice(lifetime.owner)}`;
  }, [lifetime]);
  const [eligible, granted, answered] = useSyncExternalStore(subscribe, snapshot, serverSnapshot).split(":");
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState("");
  const canEnable = eligible === "true";
  function dismiss() { rememberChoice(lifetime.owner); setDismissed(true); }
  function change(enabled: boolean) {
    try {
      // This existing method rechecks online authority at the instant of consent.
      lifetime.keepOffline(enabled);
      dismiss(); setError("");
    } catch { setError("Could not save offline permission. Verify your account online and retry."); }
  }
  return { lifetime, enabled: granted === "true", answered: answered === "true" || dismissed, canEnable, error, change, dismiss };
}

function OfflineDetails() {
  return <details className={styles.details}>
    <summary>Offline access details</summary>
    <p>Access lasts until you log out, switch accounts, or disable it in Settings on this device.</p>
    <p>Capture cannot detect remote account revocation while offline. Access ends when a rejection is received online.</p>
    <p>Only downloaded photos work offline. Local changes wait to sync. Sync and AI need the same account verified online again.</p>
  </details>;
}

/** Mounted only inside the verified document; boardReady also requires a successful sync. */
export function OfflineInvitation({ boardReady }: { boardReady: boolean }) {
  const choice = useOfflineChoice();
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(false);
  const visible = boardReady && choice.lifetime.cloud && !!choice.lifetime.owner && choice.canEnable && !choice.enabled && !choice.answered;
  useEffect(() => {
    const node = dialog.current;
    if (!visible || !node) return;
    node.showModal();
    return () => node.close();
  }, [visible]);
  if (!visible) return null;
  return <dialog ref={dialog} className={styles.card} aria-labelledby="offline-invitation-title"
    aria-describedby="offline-invitation-benefit offline-invitation-privacy" onCancel={event => { event.preventDefault(); choice.dismiss(); }}>
    <p className={styles.brand}>Capture</p>
    <h2 id="offline-invitation-title">Enable offline on this device?</h2>
    <p id="offline-invitation-benefit" className={styles.copy}>Open and edit saved notes without a connection.</p>
    <label className={styles.toggle}>
      <input type="checkbox" checked={selected} onChange={event => setSelected(event.target.checked)} />
      <span>Offline on this device</span>
      <span className={styles.state} aria-hidden="true">{selected ? "On" : "Off"}</span>
    </label>
    <p id="offline-invitation-privacy" className={styles.warning}>Shared device? Anyone using this browser could open your saved notes and downloaded photos.</p>
    <div className={styles.actions}>
      <button className="capture-btn" type="button" disabled={!selected} onClick={() => { if (selected) choice.change(true); }}>Enable offline</button>
      <button className="ghost" type="button" onClick={choice.dismiss}>Not now</button>
    </div>
    <p className={styles.hint}>You can always disable this in Settings.</p>
    {choice.error && <p role="alert">{choice.error}</p>}
  </dialog>;
}

export function OfflineSettings() {
  const choice = useOfflineChoice();
  if (!choice.lifetime.cloud || !choice.lifetime.owner) return null;
  return <div className="settings-group">
    <label className="settings-copy"><input type="checkbox" checked={choice.enabled} disabled={!choice.canEnable && !choice.enabled}
      onChange={event => choice.change(event.target.checked)} /> Keep available offline on this device</label>
    <p className="settings-copy">Shared device? Anyone using this browser could open your saved notes and downloaded photos.</p>
    <OfflineDetails />
    {choice.error && <p role="alert">{choice.error}</p>}
  </div>;
}
