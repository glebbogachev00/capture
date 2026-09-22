-- Durable, serverless-safe per-owner request ceilings for Capture Cloud.
-- The authenticated JWT chooses the owner; callers cannot pass an owner id.
create table if not exists public.capture_cloud_owner_quotas (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('managed_ai', 'board_read', 'board_write', 'backup_read')),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, scope)
);

alter table public.capture_cloud_owner_quotas enable row level security;
revoke all on table public.capture_cloud_owner_quotas from public, anon, authenticated;

-- Quota policy is database-owned. Authenticated clients may consume their own
-- counters, but they cannot supply a larger limit or shorter window to reset
-- them. Operators change policy through a reviewed migration, never through a
-- browser-callable RPC argument.
create table if not exists public.capture_cloud_quota_policies (
  scope text primary key check (scope in ('managed_ai', 'board_read', 'board_write', 'backup_read')),
  request_limit integer not null check (request_limit >= 1 and request_limit <= 1000000),
  window_seconds integer not null check (window_seconds >= 1 and window_seconds <= 2678400),
  updated_at timestamptz not null default now()
);

alter table public.capture_cloud_quota_policies enable row level security;
revoke all on table public.capture_cloud_quota_policies from public, anon, authenticated;

insert into public.capture_cloud_quota_policies (scope, request_limit, window_seconds)
values
  ('managed_ai', 200, 86400),
  ('board_read', 720, 3600),
  ('board_write', 240, 3600),
  ('backup_read', 2000, 3600)
on conflict (scope) do nothing;

-- An earlier candidate exposed policy as browser-supplied arguments. PostgreSQL
-- overloads survive CREATE OR REPLACE of a different signature, so remove the
-- old entry explicitly on upgrade before granting the scope-only function.
drop function if exists public.consume_capture_cloud_quota(text, integer, integer);

create or replace function public.consume_capture_cloud_quota(
  p_scope text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_window_started_at timestamptz;
  v_request_count integer;
  v_limit integer;
  v_window_seconds integer;
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'authenticated owner required';
  end if;
  select policy.request_limit, policy.window_seconds
    into v_limit, v_window_seconds
  from public.capture_cloud_quota_policies as policy
  where policy.scope = p_scope;
  if not found then
    raise exception 'invalid quota scope';
  end if;

  -- Hold the auth parent through the counter mutation so concurrent account
  -- deletion cannot turn an accepted request into an orphaned quota row.
  perform 1 from auth.users where id = v_user_id for key share;
  if not found then
    raise insufficient_privilege using message = 'authenticated owner unavailable';
  end if;

  insert into public.capture_cloud_owner_quotas as quota (
    user_id, scope, window_started_at, request_count, updated_at
  ) values (
    v_user_id, p_scope, v_now, 1, v_now
  )
  on conflict (user_id, scope) do update set
    window_started_at = case
      when quota.window_started_at + pg_catalog.make_interval(secs => v_window_seconds) <= v_now then v_now
      else quota.window_started_at
    end,
    request_count = case
      when quota.window_started_at + pg_catalog.make_interval(secs => v_window_seconds) <= v_now then 1
      else quota.request_count + 1
    end,
    updated_at = v_now
  where quota.window_started_at + pg_catalog.make_interval(secs => v_window_seconds) <= v_now
     or quota.request_count < v_limit
  returning window_started_at, request_count
    into v_window_started_at, v_request_count;

  if found then
    return pg_catalog.jsonb_build_object('allowed', true, 'retryAfterSec', 0);
  end if;

  select quota.window_started_at, quota.request_count
    into v_window_started_at, v_request_count
  from public.capture_cloud_owner_quotas as quota
  where quota.user_id = v_user_id and quota.scope = p_scope;

  return pg_catalog.jsonb_build_object(
    'allowed', false,
    'retryAfterSec', greatest(
      1,
      pg_catalog.ceil(extract(epoch from (
        v_window_started_at + pg_catalog.make_interval(secs => v_window_seconds) - v_now
      )))::integer
    )
  );
end;
$$;

revoke all on function public.consume_capture_cloud_quota(text) from public, anon;
grant execute on function public.consume_capture_cloud_quota(text) to authenticated;
