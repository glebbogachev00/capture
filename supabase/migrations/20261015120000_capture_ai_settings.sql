-- A Cloud member's connected AI: their provider keys and model choices.
--
-- Boundary:
--   * One row per account, holding only an AES-256-GCM sealed blob and its IV.
--     The secret that seals it (CAPTURE_AI_KEY_SECRET) lives in the app's
--     server environment, never in the database.
--   * No browser role can read or write it: RLS is on with no policies and
--     anon/authenticated have no privileges. Only the server's service role
--     touches it, after verifying the member.
--   * Deleting the account deletes the row (on delete cascade).
--
-- Not applied anywhere yet. Apply to a sandbox first, then production.

begin;

create table if not exists public.capture_ai_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  iv text not null check (length(iv) between 12 and 64),
  sealed text not null check (length(sealed) between 16 and 65536),
  updated_at timestamptz not null default now()
);

alter table public.capture_ai_settings enable row level security;
revoke all on table public.capture_ai_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.capture_ai_settings to service_role;

commit;
