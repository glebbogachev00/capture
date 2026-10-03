-- Public read-only Thread snapshots.
--
-- A snapshot is a copy the owner reviewed and confirmed: title, optional
-- introduction, optional byline and the fragment texts they ticked. It is
-- never a view of capture_boards, holds no board ids, dates or image
-- metadata, and is never edited by anything but an explicit owner write.
--
-- Boundary:
--   * anon has no table privileges at all. A reader gets one snapshot only by
--     calling capture_public_thread(token) with its exact unguessable token,
--     and gets back the public columns only (never owner_id or source_key).
--   * authenticated callers see and change their own rows only (RLS), behind
--     the same account-erasure fences as capture_boards.
--   * Unpublishing deletes the row. Account deletion cascades from auth.users;
--     while an erasure operation is open, the public function serves nothing.
--
-- Not applied anywhere yet. Apply to a sandbox first, then production, only
-- with approval (see docs/public-threads.md).

create table if not exists public.capture_public_threads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  source_key text not null,
  title text not null,
  intro text,
  byline text,
  fragments jsonb not null,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint capture_public_threads_token_shape
    check (token ~ '^([a-z0-9]+(-[a-z0-9]+)*-)?[a-z2-7]{16}$' and char_length(token) <= 72),
  constraint capture_public_threads_source_key_shape check (source_key ~ '^[a-f0-9]{64}$'),
  constraint capture_public_threads_title_bounded check (char_length(btrim(title)) between 1 and 160),
  constraint capture_public_threads_intro_bounded check (intro is null or char_length(intro) between 1 and 2000),
  constraint capture_public_threads_byline_bounded check (byline is null or char_length(byline) between 1 and 80),
  constraint capture_public_threads_fragments_array check (
    jsonb_typeof(fragments) = 'array'
    and jsonb_array_length(fragments) between 1 and 60
    and octet_length(fragments::text) <= 400000
  )
);

create index if not exists capture_public_threads_owner_idx
  on public.capture_public_threads (owner_id, updated_at desc);

alter table public.capture_public_threads enable row level security;

revoke all on table public.capture_public_threads from public, anon, authenticated;
grant select, insert, update, delete on table public.capture_public_threads to authenticated;

drop policy if exists capture_public_threads_select on public.capture_public_threads;
create policy capture_public_threads_select on public.capture_public_threads
  for select to authenticated
  using ((select auth.uid()) = owner_id and public.capture_account_read_allowed((select auth.uid())));

drop policy if exists capture_public_threads_insert on public.capture_public_threads;
create policy capture_public_threads_insert on public.capture_public_threads
  for insert to authenticated
  with check ((select auth.uid()) = owner_id and public.capture_account_write_allowed((select auth.uid())));

drop policy if exists capture_public_threads_update on public.capture_public_threads;
create policy capture_public_threads_update on public.capture_public_threads
  for update to authenticated
  using ((select auth.uid()) = owner_id and public.capture_account_write_allowed((select auth.uid())))
  with check ((select auth.uid()) = owner_id and public.capture_account_write_allowed((select auth.uid())));

drop policy if exists capture_public_threads_delete on public.capture_public_threads;
create policy capture_public_threads_delete on public.capture_public_threads
  for delete to authenticated
  using ((select auth.uid()) = owner_id and public.capture_account_write_allowed((select auth.uid())));

-- A row's owner and source key never change after insert.
create or replace function public.capture_public_threads_freeze()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id or new.token is distinct from old.token
     or new.source_key is distinct from old.source_key or new.published_at is distinct from old.published_at then
    raise exception 'owner, token, source and first publication are fixed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists capture_public_threads_freeze on public.capture_public_threads;
create trigger capture_public_threads_freeze
  before update on public.capture_public_threads
  for each row execute function public.capture_public_threads_freeze();

-- The only anonymous read: one snapshot by its exact token, public columns only.
create or replace function public.capture_public_thread(p_token text)
returns table (
  token text,
  title text,
  intro text,
  byline text,
  fragments jsonb,
  published_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.token, t.title, t.intro, t.byline, t.fragments, t.published_at, t.updated_at
  from public.capture_public_threads t
  where p_token is not null
    and char_length(p_token) <= 72
    and t.token = p_token
    and not exists (
      select 1 from public.capture_account_erasure_operations operation
      where operation.owner_id = t.owner_id and operation.stage <> 'complete'
    )
$$;

revoke all on function public.capture_public_thread(text) from public;
grant execute on function public.capture_public_thread(text) to anon, authenticated, service_role;
