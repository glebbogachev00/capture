"use client";
import { useEffect, useState, type ReactNode } from "react";
import { getDocumentLifetime, type OwnershipLifetime } from "@/lib/ownership";
import { createStorage } from "@/lib/storage";
import { downloadJSON } from "@/lib/backup";
import { readLegacyBackup, hasLegacyDatabase, importLegacyBoard, LEGACY_DEFERRED, LEGACY_RECEIPT, LEGACY_SNAPSHOT, type ImportReceipt } from "@/lib/legacyImport";

/** Runs before the board hooks, so a copy cannot race this document's hydration or sync. */
export function LegacyImportGate({ lifetime, children }: { lifetime: OwnershipLifetime; children: ReactNode }) {
  const [mode, setMode] = useState<"checking" | "offer" | "ready">(() =>
    lifetime.cloud && lifetime.owner && lifetime.snapshot() === "active" ? "checking" : "ready");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<ImportReceipt | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (mode !== "checking") return;
    let cancelled = false;
    void (async () => {
      try {
        const store = createStorage(lifetime);
        const completed = await store.get(LEGACY_RECEIPT);
        const deferred = await store.get(LEGACY_DEFERRED);
        const snapshot = await store.get(LEGACY_SNAPSHOT);
        const available = !!snapshot || await hasLegacyDatabase();
        lifetime.assertDisclosure();
        if (!cancelled) setMode(!completed && available && (!deferred || new URL(location.href).searchParams.has("import-local")) ? "offer" : "ready");
      } catch { if (!cancelled && lifetime.active) setMode("ready"); }
    })();
    return () => { cancelled = true; };
  }, [lifetime, mode]);
  if (mode === "ready") return children;
  if (mode === "checking") return <main role="status"><p>Checking this device for an earlier board…</p></main>;
  return <main className="app" style={{ maxWidth: 640, margin: "40px auto", padding: 24 }}>
    {receipt ? <>
      <h2>Imported on this device</h2>
      <p>The original board and photos are unchanged. An original archive is available in Settings.</p>
      <p>Cloud sync is separate and requires an active plan. This import does not confirm a Cloud backup.</p>
      {receipt.missingPhotos.length > 0 && <p role="alert">{receipt.missingPhotos.length} referenced {receipt.missingPhotos.length === 1 ? "photo was" : "photos were"} missing on this device. {receipt.missingPhotos.length === 1 ? "Its reference remains" : "Their references remain"} in the snapshot.</p>}
      <button className="capture-btn" onClick={() => setMode("ready")}>Open my board</button>
    </> : <>
      <h2>There’s an earlier Capture board on this device</h2>
      <p style={{ overflowWrap: "anywhere" }}>Destination account: {lifetime.owner}</p>
      <p>Import a copy into this account on this device. No paid plan is needed. The original board and photos stay unchanged.</p>
      <p>Existing account entries stay. The account profile stays if it exists. The complete earlier profile stays in the original archive.</p>
      <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /> I have permission to access and import this earlier board.</label>
      <div className="settings-group" style={{ marginTop: 20 }}>
        <button className="capture-btn" disabled={!confirmed || busy} onClick={() => {
          setBusy(true); setError("");
          void importLegacyBoard(lifetime, confirmed).then(result => {
            lifetime.assertDisclosure(); setReceipt(result);
          }).catch(() => {
            if (lifetime.active) setError("Import could not finish. Originals are unchanged. Verify your account online and retry.");
          }).finally(() => { if (lifetime.active) setBusy(false); });
        }}>{busy ? "Importing…" : "Import my local board"}</button>
        <button className="ghost" disabled={busy} onClick={() => {
          void createStorage(lifetime).set(LEGACY_DEFERRED, "1").then(() => { lifetime.assertDisclosure(); setMode("ready"); }).catch(() => {
            if (lifetime.active) setError("Could not save this choice. Please retry.");
          });
        }}>Not now</button>
      </div>
      <p>You can import later from Settings → Restore.</p>
      {error && <p role="alert">{error}</p>}
    </>}
  </main>;
}

export function LegacyImportSettings() {
  const [lifetime] = useState(getDocumentLifetime);
  const [snapshot, setSnapshot] = useState(false);
  const [receipt, setReceipt] = useState<ImportReceipt | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!lifetime.cloud || !lifetime.owner) return;
    let cancelled = false;
    void (async () => {
      const store = createStorage(lifetime);
      const saved = (await store.keys()).includes(LEGACY_SNAPSHOT);
      const completed = await store.get(LEGACY_RECEIPT);
      lifetime.assertDisclosure();
      if (!cancelled) { setSnapshot(saved); setReceipt(completed ? JSON.parse(completed) : null); }
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [lifetime]);
  if (!lifetime.cloud || !lifetime.owner) return null;
  return <div className="settings-group">
    <h4 className="settings-group-title">Earlier device board</h4>
    <p className="settings-copy">Check for an earlier local board. You must confirm access before Capture reads or copies it.</p>
    {receipt ? <p className="settings-copy">Imported on this device. {receipt.missingPhotos.length ? `${receipt.missingPhotos.length} referenced ${receipt.missingPhotos.length === 1 ? "photo was" : "photos were"} missing.` : ""} Cloud backup is not confirmed by this import.</p>
      : <a className="ghost" href="/app?import-local=1">Import earlier local board</a>}
    {snapshot && <p className="settings-copy">The download preserves the original board, photos and device entries. Restore merges supported board data and photos; existing entries and the account profile win conflicts. Device settings and unsupported entries stay archive-only. Keep this file: Restore is not a full device rollback.</p>}
    {snapshot && <button className="ghost" onClick={() => {
      void readLegacyBackup(lifetime).then(data => {
        lifetime.assertDisclosure(); downloadJSON(data, "capture-original-device-snapshot.json");
      }).catch(() => { if (lifetime.active) setError("Could not download the snapshot. Please retry."); });
    }}>Download original snapshot</button>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
