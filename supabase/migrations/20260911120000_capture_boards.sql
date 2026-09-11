-- Static contract is covered by local tests; live RLS integration remains required before rollout.
create table if not exists public.capture_boards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  board jsonb not null,
  tombstones jsonb not null default '[]'::jsonb,
  rev bigint not null check (rev >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint capture_boards_board_object check (jsonb_typeof(board) = 'object'),
  constraint capture_boards_tombstones_array check (jsonb_typeof(tombstones) = 'array'),
  constraint capture_boards_payload_bounded check (
    octet_length(board::text) + octet_length(tombstones::text) <= 2000000
  )
);

alter table public.capture_boards enable row level security;

revoke all on table public.capture_boards from anon, authenticated;
grant select, insert, update, delete on table public.capture_boards to authenticated;

create policy capture_boards_select on public.capture_boards
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy capture_boards_insert on public.capture_boards
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy capture_boards_update on public.capture_boards
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy capture_boards_delete on public.capture_boards
  for delete to authenticated
  using ((select auth.uid()) = user_id);
