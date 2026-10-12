"use client";
import { t } from "@/lib/i18n";
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
  if (mode === "checking") return <main role="status"><p>{t("Checking this device for an earlier board…")}</p></main>;
  return <main className="app" style={{ maxWidth: 640, margin: "40px auto", padding: 24 }}>
    {receipt ? <>
      <h2>{t("Imported on this device")}</h2>
      <p>{t("The original board and photos are unchanged. An original archive is available in Settings.")}</p>
      <p>{t("Cloud sync is separate and requires an active plan. This import does not confirm a Cloud backup.")}</p>
      {receipt.missingPhotos.length > 0 && <p role="alert">{receipt.missingPhotos.length === 1
        ? t("1 referenced photo was missing on this device. Its reference remains in the snapshot.")
        : t("{count} referenced photos were missing on this device. Their references remain in the snapshot.", { count: receipt.missingPhotos.length })}</p>}
      <button className="capture-btn" onClick={() => setMode("ready")}>{t("Open my board")}</button>
    </> : <>
      <h2>{t("There’s an earlier Capture board on this device")}</h2>
      <p style={{ overflowWrap: "anywhere" }}>{t("Destination account: {owner}", { owner: lifetime.owner ?? "" })}</p>
      <p>{t("Import a copy into this account on this device. No paid plan is needed. The original board and photos stay unchanged.")}</p>
      <p>{t("Existing account entries stay. The account profile stays if it exists. The complete earlier profile stays in the original archive.")}</p>
      <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /> {t("I have permission to access and import this earlier board.")}</label>
      <div className="settings-group" style={{ marginTop: 20 }}>
        <button className="capture-btn" disabled={!confirmed || busy} onClick={() => {
          setBusy(true); setError("");
          void importLegacyBoard(lifetime, confirmed).then(result => {
            lifetime.assertDisclosure(); setReceipt(result);
          }).catch(() => {
            if (lifetime.active) setError(t("Import could not finish. Originals are unchanged. Verify your account online and retry."));
          }).finally(() => { if (lifetime.active) setBusy(false); });
        }}>{busy ? t("Importing…") : t("Import my local board")}</button>
        <button className="ghost" disabled={busy} onClick={() => {
          void createStorage(lifetime).set(LEGACY_DEFERRED, "1").then(() => { lifetime.assertDisclosure(); setMode("ready"); }).catch(() => {
            if (lifetime.active) setError(t("Could not save this choice. Please retry."));
          });
        }}>{t("Not now")}</button>
      </div>
      <p>{t("You can import later from Settings → Your data.")}</p>
      {error && <p role="alert">{error}</p>}
    </>}
  </main>;
}

export function LegacyImportSettings() {
  const [lifetime] = useState(getDocumentLifetime);
  const [available, setAvailable] = useState(false);
  const [checked, setChecked] = useState(false);
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
      const earlier = saved || !!completed || await hasLegacyDatabase();
      lifetime.assertDisclosure();
      if (!cancelled) {
        setAvailable(earlier);
        setSnapshot(saved);
        setReceipt(completed ? JSON.parse(completed) : null);
        setChecked(true);
      }
    })().catch(() => { if (!cancelled) setChecked(true); });
    return () => { cancelled = true; };
  }, [lifetime]);
  if (!lifetime.cloud || !lifetime.owner || !checked || !available) return null;
  return <div className="settings-group">
    <h4 className="settings-group-title">{t("Earlier device board")}</h4>
    <p className="settings-copy">{t("Check for an earlier local board. You must confirm access before Capture reads or copies it.")}</p>
    {receipt ? <p className="settings-copy">{t("Imported on this device.")} {receipt.missingPhotos.length === 1 ? t("1 referenced photo was missing.") : receipt.missingPhotos.length ? t("{count} referenced photos were missing.", { count: receipt.missingPhotos.length }) : ""} {t("Cloud backup is not confirmed by this import.")}</p>
      : <a className="ghost" href="/app?import-local=1">{t("Import earlier local board")}</a>}
    {snapshot && <p className="settings-copy">{t("The download preserves the original board, photos and device entries. Restore merges supported board data and photos; existing entries and the account profile win conflicts. Device settings and unsupported entries stay archive-only. Keep this file: Restore is not a full device rollback.")}</p>}
    {snapshot && <button className="ghost" onClick={() => {
      void readLegacyBackup(lifetime).then(data => {
        lifetime.assertDisclosure(); downloadJSON(data, "capture-original-device-snapshot.json");
      }).catch(() => { if (lifetime.active) setError(t("Could not download the snapshot. Please retry.")); });
    }}>{t("Download original snapshot")}</button>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
