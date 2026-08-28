# Production dependency advisories

Last reviewed: 2026-08-28, against `npm audit --omit=dev --audit-level=high`.

Four high-severity advisories are reported across three packages. All three
are transitive dependencies of Next 16.2.12; none is a direct dependency of
Capture. They do not all need the same treatment: npm reports a normal,
non-breaking `npm audit fix` for the nanoid advisory, while the postcss and
sharp chain can only be moved by `--force`, which relocates Next itself.
Each is recorded here with the reason it is not reachable, rather than
closed silently.

```
capture@0.1.0
`-- next@16.2.12
  +-- postcss@8.4.31
  | `-- nanoid@3.3.16
  `-- sharp@0.34.5
```

## nanoid < 3.3.18 — custom generators can loop when size is zero

Fixable without `--force`: `npm audit fix` resolves this one on its own, and
it should be taken at the next dependency pass. It is listed here rather
than applied mid-review so the change lands on its own commit.

Reached only through postcss, which Next uses to process CSS at build time.
Capture never calls nanoid: ids come from its own `uid()`. The advisory
requires calling nanoid with a custom generator and a zero size, which
nothing in this tree does, and no runtime path reaches nanoid at all.

## postcss <= 8.5.22

Build-time only. The stylesheets it processes are the ones in this
repository; no user input reaches it. A visitor cannot cause postcss to run.

## sharp < 0.35.0

Sharp is Next's image optimiser, and Capture does not use it. There is no
`next/image` anywhere in `src` — `Landing.tsx` says so explicitly where it
uses a plain `<img>` — and photos are stored as bytes in IndexedDB and
served through `/api/img/[id]`, which returns them without transformation.
Nothing hands user-supplied image data to sharp.

## Accepted risk

The exposure is limited to build time on trusted input. The fix is to move
to a Next release that carries newer transitive versions, which is worth
doing on the next planned Next upgrade rather than as a forced downgrade
now. Re-check this file whenever Next is upgraded, and whenever a direct
dependency on any of the three appears.
