"use client";

import { cloudLoginHandoff } from "@/lib/cloudCheckoutClient";
import { QUICKSTART_URL } from "@/lib/playground";

/**
 * Persistent paths out of the browser-only playground. A visitor should
 * never need to rediscover the landing or pricing page to reach Cloud or the
 * self-hosted install instructions.
 */
export function PlaygroundNotice() {
  const cloudLogin = cloudLoginHandoff();
  return (
    <p className="playground-note">
      <span>
        This is a playground — your board lives in this browser only.{" "}
        {cloudLogin && (
          <>
            <a href={cloudLogin}>Use Capture Cloud</a>, or{" "}
          </>
        )}
        <a href={QUICKSTART_URL}>
          run Capture yourself
        </a>.
      </span>
    </p>
  );
}
