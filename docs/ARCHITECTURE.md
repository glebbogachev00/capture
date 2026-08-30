# How Capture is put together, and the rules that keep it that way

Three layers, one direction:

```
src/app/      screens and routes — composition, rendering, HTTP edges
   ↓ may import
src/hooks/    useBoard — the board's one state owner: React state, I/O,
   ↓ may import                effects, and NOTHING else worth testing
src/lib/      policy — every decision worth a test lives here, pure
```

`lib` never imports from `hooks` or `app`. `hooks` never imports from
`app`. A route (`app/api/*`) imports only `lib`.

## The rule that earns the structure

**If a change needs a test, it goes in `lib`.** The hook wires state to
policy; the screens wire the hook to pixels. When you find yourself
writing an `if` in `useBoard.ts` that could be wrong in an interesting
way, that `if` is a lib function that doesn't exist yet.

This is not aesthetics. Between two audits, useBoard grew 2,744 → 4,720
lines and the same bug class shipped five times, because logic living in a
4,000-line closure can only be tested by grepping its source. The three
extractions that started this file — `tangleOps`, `undoOps`, `adopt` —
each turned a shipped incident into an assertion within an hour of
existing.

## Enforcement, not intention

- `src/lib/ratchet.test.ts` fails the suite if `useBoard.ts` or
  `Capture.tsx` grows past its ceiling. When an extraction lands, lower
  the ceiling — that is the ratchet clicking. Raising one is a decision
  argued in a commit message, never a side effect.
- The same test pins the extracted seams at the import level: the hook
  must call `lib/adopt`, `lib/tangleOps`, `lib/undoOps`, not re-grow local
  copies.
- The full gate (`npm run check`) and the deployed-preview suite
  (`scripts/preview-verify.sh`) bracket every extraction: behavior tests
  written first against current conduct, the old bug seeded to prove the
  tests can fail, then the delegation.

## The map as it stands

Extracted and owned (policy in `lib`, tested):

| Domain | Module | The incident it guards |
|---|---|---|
| Hub adoption | `adopt.ts` | in-flight capture eaten by its own reply; cheap changed-test dropping edits |
| Undo restore | `undoOps.ts` | one Undo destroying every wrap and receipt; field-drop class (5 shipments) |
| Untangle merge | `tangleOps.ts` | "Merge" that moved 22 and merged nothing; unreachable merge |
| Sort application | `boardOps.ts` | failed sorts minting junk threads |
| Word matching | `related.ts` / `organize.ts` | two-word coincidences offered as suggestions |
| Image bytes | `imgCache.ts` | pictures blanking behind the store's write lock |
| Provider chain | `providers.ts` / `routing.ts` | 30-second sorts probing dead tiers |

| Intention save | `intentionOps.ts` | minutes of talking condensed to two lines, the rest unreachable |
| Tidy panel | `tidyPanel.ts` | dismissed suggestions resurrecting depending on repaint path |
| Failed-sort settlement | `settle.ts` | board wrote "action" while history wrote "thread" — the visible tab as transaction input |

The settlement pattern (one operation returns one typed result; the caller
applies it — adapted from Excalidraw's ActionResult and tldraw's atomic
history entries, pattern only, no dependency) came from the architecture
radar in code-audits/capture-github-architecture-radar-2026-08-30.md. Its
rule is now house rule: **the visible tab is never valid transaction
input; an explicitly open thread is, because the person chose it.**

Still living inside `useBoard`, in extraction order:

1. Wrap lifecycle
2. Successful-capture settlement (extend `settle.ts`'s shape to applySorted)
3. Durable sync outbox (radar phase two — queued pushes surviving a closed
   tab; separate change, never combined with a settlement change)

Then `Capture.tsx` decomposes into `components/` — logic-free moves, one
screen per gated step.

Deliberately not planned: splitting the hook's STATE into domain hooks.
That is the one restructuring that can break everything at once, and it
only happens with an explicit go and the two-agent (maker/critic) method.
