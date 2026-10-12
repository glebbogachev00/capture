import { countNoun, t } from "./i18n";

export type BackupRestoreNotice = {
  title?: string;
  text: string;
  details?: string[];
  ok: boolean;
};

type RestoredCounts = {
  actions: number;
  threads: number;
  fragments: number;
  intentions: number;
  principles: number;
  history: number;
  images: number;
  added: number;
};

export type BackupRestoreScope = "cloud" | "local";

const amount = (value: number, noun: string) => countNoun(value, noun);

export function backupRestoreSuccessNotice(
  counts: RestoredCounts,
  scope: BackupRestoreScope,
): BackupRestoreNotice {
  if (!counts.added) {
    return {
      title: t("Backup already here"),
      text: t("Nothing new was added."),
      details: [t("{count} verified", { count: amount(counts.images, "picture") })],
      ok: true,
    };
  }

  const board = [
    counts.actions && amount(counts.actions, "action"),
    counts.threads && amount(counts.threads, "thread"),
    counts.fragments && amount(counts.fragments, "thought"),
    counts.intentions && amount(counts.intentions, "intention"),
    counts.principles && amount(counts.principles, "principle"),
  ].filter(Boolean).join(" · ");
  const details = [
    board && t("Board: {items}", { items: board }),
    counts.history ? t("History: {count}", { count: amount(counts.history, "record") }) : "",
    t("Pictures: {count} verified", { count: amount(counts.images, "picture") }),
  ].filter(Boolean) as string[];

  return {
    title: t("Backup restored"),
    text: scope === "cloud"
      ? t("The backup was added without removing anything already in Capture Cloud.")
      : t("The backup was added without removing anything already on this device."),
    details,
    ok: true,
  };
}

export function backupRestoreCloudSavedNotice(): BackupRestoreNotice {
  return {
    title: t("Backup restored to Capture Cloud"),
    text: t("This device could not refresh its local copy. Reload Capture to open the restored board."),
    ok: true,
  };
}

export function backupRestoreCloudUnconfirmedNotice(): BackupRestoreNotice {
  return {
    title: t("Check Capture Cloud before retrying"),
    text: t("Capture could not confirm whether the restore finished. Reload Capture and check your board before trying this backup again."),
    ok: false,
  };
}

export function backupRestoreFailureNotice(error: unknown): BackupRestoreNotice {
  const message = error instanceof Error ? error.message : "";
  const name = error instanceof Error ? error.name : "";
  let text: string;

  if (/different account owner/i.test(message)) {
    text = t("This Cloud backup belongs to another account. Sign in to the account that created it, then try again.");
  } else if (/Cloud backup can only be restored/i.test(message)) {
    text = t("This file came from Capture Cloud. Sign in to the account that created it, then try again.");
  } else if (name === "QuotaExceededError" || /disk full|enough (free )?storage|could not be saved/i.test(message)) {
    text = t("This device does not have enough free storage for the backup.");
  } else if (name === "AbortError" || /verify your account|verification pending|lifetime ended/i.test(message)) {
    text = t("Capture could not confirm this Cloud account. Check your connection, reload, then try again.");
  } else if (/JSON|complete Capture backup|unreadable|invalid owner scope|is not a Capture backup/i.test(message)) {
    text = t("This file is not a complete, readable Capture backup.");
  } else if (/image|picture/i.test(message) && /missing|corrupt|verif/i.test(message)) {
    text = t("One or more pictures in this backup could not be verified.");
  } else {
    text = t("Capture could not restore this backup. Check your connection, then try again.");
  }

  return {
    title: t("Backup not restored"),
    text,
    details: [t("Your existing board was not changed.")],
    ok: false,
  };
}
