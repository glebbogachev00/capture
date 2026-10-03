# Public read-only Thread snapshots

Publish a reviewed snapshot of a Thread at an unguessable link that anyone can
read without an account, and copy it as clean Markdown for an agent.

## Flow

1. **Local Capture** (any install): Thread → More options → **Publish**. The
   thread's notes become the preview: tick what to share (none to start), edit
   the title in place, optionally add an introduction. The name is your profile
   name. Nothing leaves the device.
2. **Publish** opens `https://cloud.trycapture.app/publish` with exactly that in
   the URL *fragment* (`#publish=…`). Browsers never send a fragment to a server;
   the page clears it from the address bar and keeps the draft in that tab's
   `sessionStorage` only.
3. **Cloud, one screen at a time:** sign in if needed (the existing emailed-code
   form) → the page exactly as readers will see it, with **Publish** (or
   **Update**, when this Thread already has a link: a Thread keeps one link) →
   **Published** with the link and **Copy link**.
4. **Reading**: `/t/<token>` (page, **Copy context**) and `/t/<token>/context.md`
   (Markdown, linked from the page head for agents), no account.
5. **Owner controls** on `/publish`: copy link and unpublish; update by
   publishing the Thread again.

## Public/private boundary

| | What it can reach |
|---|---|
| Anonymous reader | `capture_public_thread(token)` only: one row, by exact token, columns `token, title, intro, byline, fragments, published_at, updated_at`. No table grant, so no listing, no owner, no source key, nothing on `capture_boards`. |
| Signed-in owner | Their own rows of `capture_public_threads` (RLS on `auth.uid() = owner_id`), behind the same account-erasure fences as `capture_boards`, through `/api/cloud/public-threads` (same identity check, `X-Capture-Owner` precondition, Cloud access check and `board_write` quota as board writes). |
| Another user | Nothing of yours: list is empty; update and unpublish return 404; a mismatched owner header returns 412. |

What a snapshot can contain is an explicit allowlist (`PublicThreadInputSchema`):
title, optional introduction, optional name, and the text of each ticked note.
Never: board or thread ids, note dates, photos or image ids, the AI Thread
summary, corrections, ledger, profile, or any other board data. The private
thread id is sent only as `sha256("capture-thread:" + id)` (`source_key`), used
solely to offer "update this Thread's link", and is never served publicly.

A snapshot is a copy. Later captures and edits to the private Thread never
change it; only an explicit update through the preview does.

Note text is untrusted. It is rendered by `PublicThreadText` as React elements
(headings, quotes, lists, emphasis, links), never as HTML, and only `http(s)`
URLs become links (`rel="nofollow ugc noopener noreferrer"`). The site-wide CSP
and `X-Frame-Options: DENY` apply. Shared content is labelled reference
material, and nothing on the page or endpoint executes it.

## Unpublishing and caches

Unpublishing deletes the row. `/t/*` responses are sent with
`Cache-Control: no-store, max-age=0` (and `X-Robots-Tag: noindex, nofollow`),
so neither Vercel nor a browser keeps a copy to serve afterwards; the next
request returns 404 for both the page and `context.md`. Copies a reader already
saved, pasted into an agent, or that a third party archived cannot be recalled.

Account deletion: snapshots cascade from `auth.users`, and while an erasure
operation is open the public function serves none of that owner's snapshots.

## Migration (not applied)

`supabase/migrations/20261003120000_capture_public_threads.sql`: one table, four
owner policies, a trigger that freezes owner/token/source/first publication,
and the anonymous read function. It depends on
`capture_account_read_allowed`, `capture_account_write_allowed` and
`capture_account_erasure_operations` from `20260922100000_account_erasure.sql`.

Apply to a sandbox project first, then production, only with approval. Do not
run `supabase db push`. Local verification against a disposable PostgreSQL:

```bash
python3 scripts/test-public-threads-sql.py
```

## Configuration

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_CAPTURE_PUBLISH_ORIGIN` | build time, every build | `https://cloud.trycapture.app` | Where the local app sends the owner to confirm, and the origin used in public links and copied context. |
| `CAPTURE_PUBLISH_PREVIEW_DIR` | development only | unset | Runs the whole flow against a local JSON file instead of Supabase, for trying it without Cloud. Refused when `NODE_ENV=production` and ignored on Cloud. Owner = cookie `capture-preview-owner` (default `preview-owner`). |

Cloud needs no new variables: it uses the existing `CAPTURE_CLOUD=1`,
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. On any other
deployment the publishing side is off (`/publish`, `/t/*` and the API return
404); the playground build also hides the button.

## Rollout order (each step needs approval)

1. Apply the migration to the sandbox, then production Supabase.
2. Deploy Capture Cloud from this branch (`vercel deploy --prod` for `capture-cloud`).
3. Merge, then update self-hosted installs so the button appears.

Until step 2, the button would open a Cloud page that does not exist yet.

## Not included

Photos (text only for now), import/fork, discovery, comments, live sync with
the private Thread, automatic publishing, AI summaries.

## Trying it locally

```bash
CAPTURE_PUBLISH_PREVIEW_DIR=/tmp/capture-publish NEXT_PUBLIC_CAPTURE_PUBLISH_ORIGIN=http://localhost:3000 npm run dev
```

Use a throwaway board (`SYNC_DATA_DIR` pointing at a copy), never the live one.
