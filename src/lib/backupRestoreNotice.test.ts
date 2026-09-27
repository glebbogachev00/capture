import { describe, expect, it } from "vitest";
import {
  backupRestoreCloudSavedNotice,
  backupRestoreFailureNotice,
  backupRestoreSuccessNotice,
} from "./backupRestoreNotice";

describe("backup restore notices", () => {
  it("formats a successful restore as a short structured receipt", () => {
    expect(backupRestoreSuccessNotice({
      actions: 3,
      threads: 2,
      fragments: 4,
      intentions: 1,
      principles: 0,
      history: 7,
      images: 57,
      added: 17,
    }, "cloud")).toEqual({
      title: "Backup restored",
      text: "The backup was added without removing anything already in Capture Cloud.",
      details: [
        "Board: 3 actions · 2 threads · 4 thoughts · 1 intention",
        "History: 7 records",
        "Pictures: 57 pictures verified",
      ],
      ok: true,
    });
  });

  it("uses device wording for a local restore", () => {
    expect(backupRestoreSuccessNotice({
      actions: 1, threads: 0, fragments: 0, intentions: 0, principles: 0,
      history: 0, images: 0, added: 1,
    }, "local").text).toBe(
      "The backup was added without removing anything already on this device.",
    );
  });

  it("reports verified Cloud success when only the local cache update fails", () => {
    expect(backupRestoreCloudSavedNotice()).toEqual({
      title: "Backup restored to Capture Cloud",
      text: "This device could not refresh its local copy. Reload Capture to open the restored board.",
      ok: true,
    });
  });

  it("never exposes internal account-verification errors", () => {
    const notice = backupRestoreFailureNotice(new DOMException(
      "Verify your account online before using Cloud or AI",
      "AbortError",
    ));
    expect(notice).toMatchObject({
      title: "Backup not restored",
      text: "Capture could not confirm this Cloud account. Check your connection, reload, then try again.",
      ok: false,
    });
    expect(JSON.stringify(notice)).not.toMatch(/Cloud or AI|AbortError|verification pending/i);
  });

  it("keeps genuine owner mismatch actionable without leaking internals", () => {
    expect(backupRestoreFailureNotice(
      new Error("This backup belongs to a different account owner."),
    ).text).toBe(
      "This Cloud backup belongs to another account. Sign in to the account that created it, then try again.",
    );
  });

  it("turns unknown server details into fixed product copy", () => {
    const notice = backupRestoreFailureNotice(
      new Error("postgres policy backup_owner_v3 rejected row secret-internal-id"),
    );
    expect(notice.text).toBe(
      "Capture could not restore this backup. Check your connection, then try again.",
    );
    expect(JSON.stringify(notice)).not.toContain("secret-internal-id");
  });

  it("does not describe a Cloud transfer quota as device storage", () => {
    const notice = backupRestoreFailureNotice(new Error("quota exceeded"));
    expect(notice.text).toBe(
      "Capture could not restore this backup. Check your connection, then try again.",
    );
    expect(notice.text).not.toMatch(/device|storage/i);
  });
});
