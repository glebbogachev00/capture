# Final owner launch acceptance

This checklist starts only after automated source, hosted desktop, hosted mobile, identity/isolation, core Polar sandbox, real-provider, cited-answer, and failed-provider checks have passed. Do not repeat those checks.

## What the agent already completed

- Full source gate: 226 test files / 2,167 tests, lint, TypeScript, production build, and trace guard.
- Hosted source gate: 40 files / 456 tests, disposable billing/quota/erasure/retention and image SQL, and synthetic image client failure cases.
- Two-account identity and board ownership boundaries.
- Polar sandbox checkout, entitlement, portal, and scheduled cancellation.
- Real-provider explicit-task preservation.
- Every-provider-dead unsorted capture preservation.
- Authenticated desktop and 390×844 mobile Search-that-answers, including connected Thread navigation and no duplicate Recall request.
- Anonymous 390×844 local capture/Search with zero Recall requests.
- Synthetic test data cleanup and hosted visible-board readback.
- Offline/provider-failure captures are now separated from normal Actions into a minimal **Waiting to sort** strip; exact text/images survive retry, and paid offline access is bounded to the exact owner and verified expiry.

## Session A — only if paid public Cloud is in this launch

Owner decisions or provider-side evidence are still required for:

1. Decide whether paid public Cloud ships now or remains an internal cohort.
2. Approve privacy, terms, retention, and provider-processing scope.
3. Resolve authenticated Cloud export/restore scope.
4. Resolve the account-erasure contract before implementation.
5. Confirm the provider spend ceiling.
6. Exercise terminal billing expiry/revocation, past-due timing, duplicate webhook delivery, and reconciliation retry.
7. Reuse prior hosted image-publication evidence if it can be located. Do not repeat the campaign unless the existing evidence cannot prove the exact candidate bucket, five race rounds, cross-account denial, and readback.
8. Logout/expiry/cross-tab revocation can be checked last because it invalidates the saved test session and requires another OTP sign-in.

If paid public Cloud is excluded from launch, these items do not block the account-free/local launch.

## Session B — physical-device acceptance

Use the current frozen Preview, not Production.

### Phone / installed PWA

1. Open `https://capture-cloud-sandbox.vercel.app/app` on the phone and sign into the sandbox account before enabling offline support.
2. Install/add Capture to the Home Screen and launch the installed app.
3. Reload twice. Confirm the app remains usable and no stale-build notice remains.
4. Confirm the simplified offline invitation is clear, enable offline support, then close the PWA completely and reopen it.
5. Enable airplane mode and create a disposable long text capture with one disposable photo. Confirm it appears in **Waiting to sort**, not in Actions, and the exact text/photo remain available after reload.
6. While still offline, confirm a currently entitled Cloud account does not show the free 15-capture counter and the **Sort** control cannot make a network request.
7. Disable airplane mode and tap **Sort**. Confirm the waiting card remains if sorting fails, disappears only after a successful sort, and the final Action/Thread/Intention preserves the exact text and photo.
8. Open an ordinary Action’s shelf menu and confirm the options are balanced, readable, and usable with touch.

### Second device and native sharing

9. On a second clean physical device/browser, sign into the same sandbox account and confirm the same board appears.
10. Make one disposable edit on each device, reload both, and confirm neither edit disappears.
11. Share a selected day and a Thread to a real native receiver. Confirm the text and any intended image attachment arrive correctly.
12. Delete or Undo all disposable content and confirm both devices agree.

### Owner trial and approval

13. Use Capture normally for two or three days. Record only concrete failures; do not repeat synthetic checks.
14. Give explicit release approval only after choosing whether paid public Cloud is included.

## Prompt for an auxiliary browser agent

Test only the current Capture Preview at `https://capture-cloud-sandbox.vercel.app`. Do not mutate Production, do not purchase anything, do not create accounts, and do not repeat automated tests already completed. Assist the owner with the physical-device checklist: public-route navigation, installed-PWA reopen and double reload, visible stale-build warnings, real airplane-mode local capture/edit/photo continuity, reconnect behavior, second-device board recovery, concurrent disposable edits, and native share to a real receiver. Use disposable synthetic text only. Never expose OTPs, cookies, owner IDs, payment details, or private captures. Record exact pass/fail evidence and clean up disposable visible content. Report blockers honestly; browser emulation is not evidence for a physical PWA, real airplane mode, OS-native sharing, or a second physical device.
