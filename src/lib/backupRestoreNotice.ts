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

const amount = (value: number, singular: string, plural = `${singular}s`) =>
  `${value} ${value === 1 ? singular : plural}`;

export function backupRestoreSuccessNotice(
  counts: RestoredCounts,
  scope: BackupRestoreScope,
): BackupRestoreNotice {
  if (!counts.added) {
    return {
      title: "Backup already here",
      text: "Nothing new was added.",
      details: [amount(counts.images, "picture") + " verified"],
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
    board && `Board: ${board}`,
    counts.history ? `History: ${amount(counts.history, "record")}` : "",
    `Pictures: ${amount(counts.images, "picture")} verified`,
  ].filter(Boolean) as string[];

  return {
    title: "Backup restored",
    text: scope === "cloud"
      ? "The backup was added without removing anything already in Capture Cloud."
      : "The backup was added without removing anything already on this device.",
    details,
    ok: true,
  };
}

export function backupRestoreCloudSavedNotice(): BackupRestoreNotice {
  return {
    title: "Backup restored to Capture Cloud",
    text: "This device could not refresh its local copy. Reload Capture to open the restored board.",
    ok: true,
  };
}

export function backupRestoreFailureNotice(error: unknown): BackupRestoreNotice {
  const message = error instanceof Error ? error.message : "";
  const name = error instanceof Error ? error.name : "";
  let text: string;

  if (/different account owner/i.test(message)) {
    text = "This Cloud backup belongs to another account. Sign in to the account that created it, then try again.";
  } else if (/Cloud backup can only be restored/i.test(message)) {
    text = "This file came from Capture Cloud. Sign in to the account that created it, then try again.";
  } else if (name === "QuotaExceededError" || /disk full|enough (free )?storage|could not be saved/i.test(message)) {
    text = "This device does not have enough free storage for the backup.";
  } else if (name === "AbortError" || /verify your account|verification pending|lifetime ended/i.test(message)) {
    text = "Capture could not confirm this Cloud account. Check your connection, reload, then try again.";
  } else if (/JSON|complete Capture backup|unreadable|invalid owner scope|is not a Capture backup/i.test(message)) {
    text = "This file is not a complete, readable Capture backup.";
  } else if (/image|picture/i.test(message) && /missing|corrupt|verif/i.test(message)) {
    text = "One or more pictures in this backup could not be verified.";
  } else {
    text = "Capture could not restore this backup. Check your connection, then try again.";
  }

  return {
    title: "Backup not restored",
    text,
    details: ["Your existing board was not changed."],
    ok: false,
  };
}
