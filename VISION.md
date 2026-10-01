# Capture — Vision

Capture is an open-source thinking companion that helps people get thoughts in,
keep them alive, find them again and act on them, with as little friction as possible. It supports
thinking rather than replacing it, and aims for a smooth flow between human and AI.

## North Star

Remove friction from thinking.

## Core Philosophy

- **Build for yourself first.** Every feature starts with a real friction you've felt.
- **Simplicity and convenience beat feature count.** Features are earned by repeated
  friction, not imagination.
- **The pipeline is fixed:** observe, break it down, define exact requirements, find
  the simplest solution, build, use, repeat.
- **Ideas are not backlog items.** Only observed frictions become backlog items.

## Product Identity

A thinking system, not a notes app.

## The four phases

Capture is built in phases, in this order. Every change should say which phase it
serves; work that serves none of them waits. (From the Capture thread, 13 and 26
Sep 2026.)

1. **Get it in.** Capturing is effortless, and each thought lands where the person
   meant it to: sorted in line with their intention, never lost, even offline or
   when a model fails. "Done" is a score on the held-out sorting sets, not
   perfection: sorting is never perfect, and chasing it starves the later phases.
2. **Keep it alive.** Nothing quietly turns into junk. A thread says plainly what is
   decided, what is still open, and what keeps coming up without being acted on;
   finished work is labelled; stale things fade or are let go.
3. **Find it.** Ask anything and get an answer from your own notes, in their words,
   with a link to where it came from.
4. **Decide and hand off.** What you decided and what is still open are on the board,
   so you — or an agent you hand a thread to — can act without rereading everything.

Deciding and acting happen *inside* the objects below, not on new surfaces: a
thread's summary is where a decision becomes visible, and Distill is where an
unclear thought gets worked out. Naming the phases is not an invitation to build
screens for them.

**Core objects:**

- **Actions** — quick thoughts or tasks. Temporary by default (they fade), but can
  evolve into something larger.
- **Threads** — living notes that grow over time. Each is summarized from its
  fragments when the configured AI provider is available.
- **Intentions** — not goals. A decision about a future state you inhabit now, with
  supporting actions and counter-intentions. No checkbox, no shelf life: an action is
  finished, an intention is lived.

Opinionated, not for everyone. The opinion shows up in the defaults (fade-by-default,
no checkboxes on intentions, quiet AI) — not in a tagline.

## Two Input Modes (same input, two buttons)

- **Capture** — for clear thoughts. You say it, AI files it.
- **Distill** — for unclear thoughts. Start a focused conversation, clarify, and save
  the distilled output as an action, thread, or intention.

Voice is an input method, not the product.

## AI's Role

Quiet assistance. It organizes, summarizes, and asks clarifying questions only when
needed. It never overwhelms and never takes over. The Organize review is on demand,
not automatic — the AI looks at the board only when you tap the wand, and proposes;
it never mutates on its own.

Photos ride along with the thinking: they shrink at capture, the sorter can see
them (via a vision tier when one is configured), backups keep them, and a share
carries them. Media is storage-light by design.

The assistant is configured by a set of **principles** that keep it quiet, clarifying,
and dependency-reducing — its purpose is to help you think clearly and become *less*
dependent on it over time. This is why it files and summarizes but does not write your
thoughts for you.

## Open Source & Free First

Bring your own keys. Provider-agnostic: the app tries each configured provider in order
and falls back when one is spent.

Onboarding explains the keys, links to where to get them, validates on paste, stores
them locally, and lets you rotate or remove them anytime.

## What Capture Does NOT Do

- **No reminders, nudges, or streaks.** If it isn't captured, it isn't pending.
- **No collaboration or social feed.** Share is explicit and one-shot — it exports, it
  does not broadcast.
- **No folders, tags, or taxonomy to maintain.** Organization emerges from the three
  object types.
- **No AI auto-writing your thoughts.** It files, summarizes, and clarifies; you decide.
- **No lock-in, and no account required.** Local-first: your keys, your data, the
  full thinking system free. Capture Cloud (managed sync and backup) is an optional
  convenience, never needed to think with Capture. If removing a paid service would
  make the free product worse at thinking, it is the wrong thing to charge for.

## Sharing Philosophy

Don't market features; share discoveries. Show what you learned. Let the product be
proof, not the pitch.

(The in-app Share button exports a thread or intention. The *sharing philosophy* is
about how the work is talked about publicly — the two are different and both intentional.)
