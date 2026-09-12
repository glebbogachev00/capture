"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Download, Share, SquarePlus, X } from "lucide-react";

const VISITED_KEY = "capture:install-visited:v1";
const DISMISSED_KEY = "capture:install-dismissed:v1";
const DISMISS_FOR_MS = 7 * 24 * 60 * 60 * 1000;

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

function isIosDevice() {
  const nav = window.navigator;
  return /iPad|iPhone|iPod/.test(nav.userAgent) ||
    (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
}

function isInstalled() {
  const nav = window.navigator as NavigatorWithStandalone;
  return nav.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true;
}

function readDismissedAt() {
  try {
    return Number(window.localStorage.getItem(DISMISSED_KEY) || 0);
  } catch {
    return 0;
  }
}

function canInvite() {
  return isIosDevice() && !isInstalled() && Date.now() - readDismissedAt() >= DISMISS_FOR_MS;
}

const noSubscribe = () => () => undefined;
const serverSnapshot = () => false;

export function InstallInvitation({
  successfulCapture,
  hasExistingCapture,
}: {
  successfulCapture: boolean;
  hasExistingCapture: boolean;
}) {
  const clientReady = useSyncExternalStore(noSubscribe, () => true, serverSnapshot);
  const returning = useSyncExternalStore(
    noSubscribe,
    () => window.localStorage.getItem(VISITED_KEY) === "1",
    serverSnapshot
  );
  const [open, setOpen] = useState(false);
  const [dismissedNow, setDismissedNow] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(VISITED_KEY, "1");
    } catch {
      // A blocked store should not stop Capture itself.
    }
  }, []);

  const visible =
    clientReady &&
    !dismissedNow &&
    canInvite() &&
    (successfulCapture || (returning && hasExistingCapture));

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      // The in-memory dismissal still applies for this visit.
    }
    setOpen(false);
    setDismissedNow(true);
  }

  if (!visible) return null;

  return (
    <>
      <button
        className="install-invite-trigger"
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Add Capture to Home Screen"
        title="Add Capture to Home Screen"
      >
        <Download size={20} strokeWidth={1.8} />
      </button>

      {open && (
        <div className="install-invite-backdrop" role="presentation">
          <section
            className="install-invite-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-invite-title"
          >
            <button
              className="install-invite-close"
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              <X size={18} strokeWidth={1.7} />
            </button>

            <p className="install-invite-kicker">Add to Home Screen</p>
            <h2 id="install-invite-title">Keep Capture close.</h2>

            <ol className="install-invite-steps">
              <li>
                <span className="install-invite-step-icon"><Share size={19} /></span>
                <span><strong><b>1</b> Open Share</strong><small>Tap Share, or choose Share from the browser menu.</small></span>
              </li>
              <li>
                <span className="install-invite-step-icon"><SquarePlus size={19} /></span>
                <span><strong><b>2</b> Add to Home Screen</strong><small>Scroll through the actions if needed.</small></span>
              </li>
              <li>
                <span className="install-invite-step-icon"><Check size={19} /></span>
                <span><strong><b>3</b> Tap Add</strong><small>Keep “Open as Web App” on if shown.</small></span>
              </li>
            </ol>

            <p className="install-invite-help">
              Can’t find “Add to Home Screen”? Open this page in Safari and try again.
            </p>
            <button className="install-invite-later" type="button" onClick={dismiss}>
              Not now
            </button>
          </section>
        </div>
      )}
    </>
  );
}
