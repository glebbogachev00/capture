# Capture — "what's the easy way to build this?" prompt (for DeepSeek / Claude)

Paste this (plus `specs/capture-built-status.md`) into the model. It tells the model to scan the remaining feature list and return the LOWEST-EFFORT build paths — not a full plan, just the cheap wins and the order that minimizes risk.

---

## Prompt to paste

```
You are helping build Capture, a local-first personal capture app (text/voice/image
→ filed as action / thread / intention). Most of the core is already built. Your job
is NOT to plan everything — it is to find the EASIEST ways to build what's left.

Read these first (they are already in the repo):
- specs/capture-built-status.md  — what exists (do not rebuild these)
- specs/capture-deepseek-build.md — constraints + file map
- specs/capture-tidy-connect-prompt.md — the Connect-intelligence design
- src/lib/organize.ts, src/lib/organizeAi.ts, src/lib/related.ts, src/lib/ledger.ts,
  src/hooks/useBoard.ts — the existing machinery to build ON, not around

The remaining features (from built-status "NOT BUILT"):
1. Connect-intelligence — event-driven relationship proposals (no graph UI).
   Triggers: action_resolved_in_thread, thread_matured_to_action,
   intention_contradicted, same_idea_two_kinds, stale_thread_open_action.
2. graph.json — derived connection index for the future agent (advisory, rebuildable,
   never rendered as UI).
3. Assistant mode — third mode: ask about app, run tasks, review threads.
4. Video capture + web-page capture (deferred; need native shell).
5. Sync verification (device-to-device end-to-end).
6. Voice growth: wake word, voice choice, push-to-talk desktop.
7. Embeddings / semantic index (deferred).

Your output should be SHORT and ACTION-ORIENTED. For each remaining feature, answer:
- Cheapest viable build: what existing function/file does 80% of the work?
- What NEW code is actually required (be specific, file-level)?
- Effort estimate (S/M/L) and the single biggest risk.
- Dependencies — what must exist before this is worth starting.

Then give ONE recommended order that maximizes shipped value per unit effort,
explicitly skipping anything premature (e.g. don't build graph.json before Assistant
exists; don't build embeddings while phrase-match works).

Constraints (non-negotiable):
- Reuse organize.ts / related.ts / useBoard mutations. No parallel proposal system.
- Agent suggests, user approves. No auto-mutate, no auto-apply.
- Deterministic logic before model calls. Opt-in only for anything that spends quota.
- Learned rules inspectable + clearable. Few-shot hard-capped.
- Verify: npm run lint && npm run test && npx tsc --noEmit. No npm run build if
  npm run dev is live on port 3000.
- No secrets in diff. Report what you'd build, not just theory.
```

---

## How to use this

1. Paste `specs/capture-built-status.md` then this prompt into DeepSeek (or Claude).
2. He returns: cheap build paths per feature + a value-per-effort order.
3. You pick the top 1-2 and hand them back as a build brief (we already have the
   Connect + Assistant designs if those win).

This deliberately asks for the EASY paths only — not a spec rewrite. That matches
your ask: "what are the ways to actually build this" with least friction.
