# Writing pages

`/writing` lists two things: native **Articles** (pages on this site) and
**Shared threads** (cards that open a thread already published on Capture
Cloud). Both are plain TypeScript data; there is no CMS.

| File | Holds |
| --- | --- |
| `src/content/articles.ts` | The type, the three site-edited articles (with source moments), and `ARTICLES`, sorted newest first |
| `src/content/xArticles.ts` | Personal X Articles published as written, with no source moments |
| `src/content/sharedThreads.ts` | Shared-thread cards: title, blurb, public `cloud.trycapture.app/t/…` link, portrait |
| `public/writing/` | Article covers (`<slug>.jpg`) and shared-thread portraits (`thread-<slug>.jpg`) |

## Adding an article

1. Save the cover as `public/writing/<slug>.jpg`. Read its real size with
   `sips -g pixelWidth -g pixelHeight public/writing/<slug>.jpg`.
2. Add a record to `X_ARTICLES` (or `SITE_ARTICLES` for a site-edited piece):
   `slug`, `title`, `description` (one or two sentences for search results),
   `publishedAt` (`YYYY-MM-DD`, the day it went out in Vietnam time),
   `sourceMoments: []`, `cover`, `original` (the X post), and `body`.
3. The body is the article text without its `# Title` line. Paragraphs are
   separated by blank lines; `## ` makes a heading, `> ` a quote, and
   `[label](https://…)`, bare `https://` links and `**bold**` render as such.
   Escape backticks and `${` inside the template string.
4. Only add `sourceMoments`, `threadSummary` or `provenance` when they are real
   and already public. Without them the record panel is simply left out.

The sitemap, metadata (with the cover as the share image), and the
"Try Capture" ending come from the record automatically.

## Adding a shared thread

Publish it from Capture first. Then save a square portrait as
`public/writing/thread-<slug>.jpg` (640px is plenty) and add a record to
`SHARED_THREADS` with its public link. Don't copy the thread's text here: the
Cloud page stays the source, so updating or unpublishing it works as usual.
If a portrait needs attribution, add it to the credits line in
`src/app/writing/page.tsx`.

## Checking

```bash
npx vitest run src/content src/components/PublicThreadArticle.test.tsx src/lib/seo.test.ts
NEXT_PUBLIC_PUBLIC_SITE=1 npm run dev
```

Then open `/writing` and the new page.
