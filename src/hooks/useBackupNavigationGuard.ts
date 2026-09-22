"use client";

import { useEffect, type RefObject } from "react";
import type { BackupOperationGate } from "@/lib/backupOperation";

export function useBackupNavigationGuard(gate: RefObject<BackupOperationGate>): void {
  useEffect(() => {
    const hold = (event: BeforeUnloadEvent) => {
      if (!gate.current.restoreActive) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [gate]);
}
