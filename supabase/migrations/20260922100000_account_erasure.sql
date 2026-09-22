-- Capture Cloud account erasure: durable service-only workflow and write fence.
-- Source-only migration. Hosted application and provider acceptance are separate gates.
begin;
set local lock_timeout = '10s';

create table if not exists public.capture_account_erasure_operations (
  operation_id uuid primary key,
  owner_id uuid,
  session_id_hash text,
  receipt_secret_hash text not null,
  stage text not null check (stage in ('prepared','polar','sessions','storage','app_rows','auth','complete')),
  lease_id uuid,
  lease_expires_at timestamptz,
  version bigint not null default 1 check (version >= 1),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  retry_count integer not null default 0 check (retry_count >= 0),
  retry_after timestamptz,
  last_error_code text check (last_error_code ~ '^[a-z0-9_]{1,64}$'),
  confirmed_at timestamptz,
  completed_at timestamptz,
  receipt_expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (receipt_secret_hash ~ '^[0-9a-f]{64}$'),
  check (session_id_hash is null or session_id_hash ~ '^[0-9a-f]{64}$'),
  check ((stage = 'prepared') = (confirmed_at is null)),
  check ((stage = 'complete') = (completed_at is not null)),
  check (completed_at is null or receipt_expires_at <= completed_at + interval '30 days'),
  check ((lease_id is null) = (lease_expires_at is null))
);
create unique index if not exists capture_account_erasure_receipt_hash
  on public.capture_account_erasure_operations(receipt_secret_hash);
create unique index if not exists capture_account_erasure_one_active_owner
  on public.capture_account_erasure_operations(owner_id)
  where owner_id is not null and stage <> 'complete';
create index if not exists capture_account_erasure_worker_due
  on public.capture_account_erasure_operations(retry_after, lease_expires_at, created_at)
  where stage not in ('prepared','complete');
create index if not exists capture_account_erasure_receipt_expiry
  on public.capture_account_erasure_operations(receipt_expires_at)
  where stage in ('prepared','complete');

alter table public.capture_account_erasure_operations enable row level security;
revoke all on table public.capture_account_erasure_operations from public, anon, authenticated;
grant select, insert, update, delete on table public.capture_account_erasure_operations to service_role;

create table if not exists public.capture_external_work_admissions (
  admission_id uuid primary key,
  owner_id uuid not null,
  kind text not null check (kind in ('managed_ai','polar_checkout','polar_portal','polar_reconcile')),
  lease_expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists capture_external_work_owner_active
  on public.capture_external_work_admissions(owner_id, lease_expires_at);
alter table public.capture_external_work_admissions enable row level security;
revoke all on table public.capture_external_work_admissions from public, anon, authenticated;
grant select, insert, update, delete on table public.capture_external_work_admissions to service_role;

create table if not exists public.capture_external_capabilities (
  capability_id uuid primary key,
  owner_id uuid not null,
  kind text not null check (kind in ('polar_checkout','polar_portal')),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists capture_external_capability_owner_active
  on public.capture_external_capabilities(owner_id, expires_at);
alter table public.capture_external_capabilities enable row level security;
revoke all on table public.capture_external_capabilities from public, anon, authenticated;
grant select, insert, update, delete on table public.capture_external_capabilities to service_role;

create or replace function public.capture_account_owner_lock(p_user_id uuid)
returns void language sql security definer set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 912221));
$$;
revoke all on function public.capture_account_owner_lock(uuid) from public, anon, authenticated;
grant execute on function public.capture_account_owner_lock(uuid) to service_role;

create or replace function public.acquire_capture_external_work(
  p_admission_id uuid,
  p_owner_id uuid,
  p_kind text,
  p_now timestamptz,
  p_lease_expires_at timestamptz,
  p_capability_id uuid default null,
  p_capability_expires_at timestamptz default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_caller uuid := auth.uid();
begin
  if p_owner_id is null or p_kind not in ('managed_ai','polar_checkout','polar_portal','polar_reconcile')
     or p_lease_expires_at <= p_now or p_lease_expires_at > p_now + interval '10 minutes'
     or (p_kind in ('managed_ai','polar_reconcile') and (p_capability_id is not null or p_capability_expires_at is not null))
     or (p_kind in ('polar_checkout','polar_portal') and (p_capability_id is null or p_capability_expires_at is null
       or p_capability_expires_at <= p_now or p_capability_expires_at > p_now + interval '30 days')) then
    raise exception 'invalid external work admission';
  end if;
  if v_caller is not null and v_caller is distinct from p_owner_id then
    raise insufficient_privilege using message = 'exact owner required';
  end if;
  perform public.capture_account_owner_lock(p_owner_id);
  delete from public.capture_external_work_admissions
    where owner_id = p_owner_id and lease_expires_at <= p_now;
  delete from public.capture_external_capabilities
    where owner_id = p_owner_id and expires_at <= p_now;
  perform 1 from auth.users where id = p_owner_id for key share;
  if not found or exists (
    select 1 from public.capture_account_erasure_operations
    where owner_id = p_owner_id and stage not in ('prepared','complete')
  ) then return false; end if;
  insert into public.capture_external_work_admissions(admission_id,owner_id,kind,lease_expires_at)
    values(p_admission_id,p_owner_id,p_kind,p_lease_expires_at);
  if p_kind in ('polar_checkout','polar_portal') then
    -- Reserve the capability before invoking Polar. A provider success followed
    -- by a lost app response therefore remains visible to confirmation.
    insert into public.capture_external_capabilities(capability_id,owner_id,kind,expires_at)
      values(p_capability_id,p_owner_id,p_kind,p_capability_expires_at);
  end if;
  return true;
end;
$$;

create or replace function public.release_capture_external_work(
  p_owner_id uuid,
  p_admission_id uuid
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_caller uuid := auth.uid();
begin
  if v_caller is not null and v_caller is distinct from p_owner_id then
    raise insufficient_privilege using message = 'exact owner required';
  end if;
  perform public.capture_account_owner_lock(p_owner_id);
  delete from public.capture_external_work_admissions
    where owner_id = p_owner_id and admission_id = p_admission_id;
  return true;
end;
$$;

create or replace function public.capture_external_work_active(p_owner_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.capture_external_work_admissions
    where owner_id = p_owner_id and lease_expires_at > clock_timestamp());
$$;
revoke all on function public.acquire_capture_external_work(uuid,uuid,text,timestamptz,timestamptz,uuid,timestamptz) from public, anon;
revoke all on function public.release_capture_external_work(uuid,uuid) from public, anon;
revoke all on function public.capture_external_work_active(uuid) from public, anon, authenticated;
grant execute on function public.acquire_capture_external_work(uuid,uuid,text,timestamptz,timestamptz,uuid,timestamptz) to authenticated, service_role;
grant execute on function public.release_capture_external_work(uuid,uuid) to authenticated, service_role;
grant execute on function public.capture_external_work_active(uuid) to service_role;

create or replace function public.capture_account_deleting(p_user_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare v_caller uuid := auth.uid();
begin
  if v_caller is not null and v_caller is distinct from p_user_id then
    raise insufficient_privilege using message = 'exact owner required';
  end if;
  return p_user_id is not null and exists (
    select 1 from public.capture_account_erasure_operations operation
    where operation.owner_id = p_user_id
      and operation.stage not in ('prepared','complete')
  );
end;
$$;
revoke all on function public.capture_account_deleting(uuid) from public, anon;
grant execute on function public.capture_account_deleting(uuid) to authenticated, service_role;

-- Supabase Auth's installed Admin API revokes globally only from a user's JWT,
-- not by owner UUID. During the retryable provider stages the durable database
-- fence is the session authority. Auth hard-delete remains last and revokes the
-- refresh-token families after all external and application data is empty.
create or replace function public.establish_capture_account_session_fence(p_owner_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform public.capture_account_owner_lock(p_owner_id);
  return exists(select 1 from public.capture_account_erasure_operations
    where owner_id = p_owner_id and stage in ('sessions','storage','app_rows','auth'));
end;
$$;
create or replace function public.capture_account_session_fence_authoritative(p_owner_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.capture_account_erasure_operations
    where owner_id = p_owner_id and stage in ('sessions','storage','app_rows','auth'));
$$;
revoke all on function public.establish_capture_account_session_fence(uuid) from public, anon, authenticated;
revoke all on function public.capture_account_session_fence_authoritative(uuid) from public, anon, authenticated;
grant execute on function public.establish_capture_account_session_fence(uuid) to service_role;
grant execute on function public.capture_account_session_fence_authoritative(uuid) to service_role;

-- Every database-owned mutation takes the owner transaction lock before it
-- checks for an operation. This covers the no-row window: a write admitted
-- before prepare commits before the fence, while prepare/confirmation admitted
-- first make the waiting mutation observe a non-prepared stage and deny.
create or replace function public.capture_account_write_allowed(p_user_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare v_stage text; v_caller uuid := auth.uid();
begin
  if p_user_id is null then return false; end if;
  if v_caller is not null and v_caller is distinct from p_user_id then
    raise insufficient_privilege using message = 'exact owner required';
  end if;
  perform public.capture_account_owner_lock(p_user_id);
  select stage into v_stage from public.capture_account_erasure_operations
    where owner_id = p_user_id and stage <> 'complete'
    for share;
  if not found then return true; end if;
  return v_stage = 'prepared';
end;
$$;
revoke all on function public.capture_account_write_allowed(uuid) from public, anon;
grant execute on function public.capture_account_write_allowed(uuid) to authenticated, service_role;

-- Exact-owner recovery reads remain available while an operation is merely
-- prepared. Confirmation installs the same transaction-locked fence for every
-- read, including backup/export and image bytes.
create or replace function public.capture_account_read_allowed(p_user_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare v_stage text; v_caller uuid := auth.uid();
begin
  if p_user_id is null then return false; end if;
  if v_caller is not null and v_caller is distinct from p_user_id then
    raise insufficient_privilege using message = 'exact owner required';
  end if;
  select stage into v_stage from public.capture_account_erasure_operations
    where owner_id = p_user_id and stage <> 'complete'
    for share;
  if not found then return true; end if;
  return v_stage = 'prepared';
end;
$$;
revoke all on function public.capture_account_read_allowed(uuid) from public, anon;
grant execute on function public.capture_account_read_allowed(uuid) to authenticated, service_role;

create or replace function public.cleanup_capture_account_erasure_receipts()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare v_count integer;
begin
  with expired as (
    select operation_id from public.capture_account_erasure_operations
    where stage in ('prepared','complete') and receipt_expires_at <= clock_timestamp()
    order by receipt_expires_at asc
    for update skip locked
    limit 1000
  )
  delete from public.capture_account_erasure_operations operation
  using expired where operation.operation_id = expired.operation_id
    and operation.stage in ('prepared','complete')
    and operation.receipt_expires_at <= clock_timestamp();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.prepare_capture_account_erasure(
  p_operation_id uuid,
  p_owner_id uuid,
  p_session_id_hash text,
  p_receipt_secret_hash text,
  p_receipt_expires_at timestamptz
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  operation public.capture_account_erasure_operations%rowtype;
begin
  if p_session_id_hash !~ '^[0-9a-f]{64}$' or p_receipt_secret_hash !~ '^[0-9a-f]{64}$'
     or p_receipt_expires_at <= v_now or p_receipt_expires_at > v_now + interval '1 hour' then
    raise exception 'invalid erasure preparation';
  end if;
  perform public.capture_account_owner_lock(p_owner_id);
  perform 1 from auth.users where id = p_owner_id for key share;
  if not found then return null; end if;
  perform public.cleanup_capture_account_erasure_receipts();
  select * into operation from public.capture_account_erasure_operations
    where owner_id = p_owner_id and stage <> 'complete' for update;
  if found and operation.stage <> 'prepared' then return null; end if;
  if found then
    update public.capture_account_erasure_operations set
      session_id_hash = p_session_id_hash,
      receipt_secret_hash = p_receipt_secret_hash,
      receipt_expires_at = p_receipt_expires_at,
      version = version + 1,
      updated_at = v_now
    where operation_id = operation.operation_id returning * into operation;
  else
    insert into public.capture_account_erasure_operations(
      operation_id, owner_id, session_id_hash, receipt_secret_hash, stage, receipt_expires_at
    ) values (
      p_operation_id, p_owner_id, p_session_id_hash, p_receipt_secret_hash, 'prepared', p_receipt_expires_at
    ) returning * into operation;
  end if;
  return jsonb_build_object(
    'operationId', operation.operation_id, 'ownerId', operation.owner_id,
    'stage', operation.stage, 'version', operation.version,
    'attemptCount', operation.attempt_count, 'retryCount', operation.retry_count,
    'retryAfter', operation.retry_after, 'lastErrorCode', operation.last_error_code,
    'leaseId', operation.lease_id, 'leaseExpiresAt', operation.lease_expires_at,
    'confirmedAt', operation.confirmed_at, 'completedAt', operation.completed_at,
    'receiptExpiresAt', operation.receipt_expires_at
  );
end;
$$;

create or replace function public.status_capture_account_erasure(
  p_operation_id uuid,
  p_receipt_secret_hash text,
  p_owner_id uuid,
  p_session_id_hash text
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare operation public.capture_account_erasure_operations%rowtype;
begin
  select * into operation from public.capture_account_erasure_operations
    where operation_id = p_operation_id
      and receipt_secret_hash = p_receipt_secret_hash
      and receipt_expires_at > clock_timestamp()
      and ((owner_id is null and stage = 'complete')
        or (owner_id = p_owner_id and session_id_hash = p_session_id_hash));
  if not found then return null; end if;
  return jsonb_build_object(
    'operationId', operation.operation_id, 'ownerId', operation.owner_id,
    'stage', operation.stage, 'version', operation.version,
    'attemptCount', operation.attempt_count, 'retryCount', operation.retry_count,
    'retryAfter', operation.retry_after, 'lastErrorCode', operation.last_error_code,
    'leaseId', operation.lease_id, 'leaseExpiresAt', operation.lease_expires_at,
    'confirmedAt', operation.confirmed_at, 'completedAt', operation.completed_at,
    'receiptExpiresAt', operation.receipt_expires_at
  );
end;
$$;

create or replace function public.confirm_capture_account_erasure(
  p_operation_id uuid,
  p_owner_id uuid,
  p_session_id_hash text,
  p_receipt_secret_hash text
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  operation public.capture_account_erasure_operations%rowtype;
begin
  perform public.capture_account_owner_lock(p_owner_id);
  delete from public.capture_external_work_admissions
    where owner_id = p_owner_id and lease_expires_at <= v_now;
  delete from public.capture_external_capabilities
    where owner_id = p_owner_id and expires_at <= v_now;
  select * into operation from public.capture_account_erasure_operations
    where operation_id = p_operation_id for update;
  if not found or operation.owner_id is distinct from p_owner_id
     or operation.session_id_hash is distinct from p_session_id_hash
     or operation.receipt_secret_hash is distinct from p_receipt_secret_hash
     or operation.receipt_expires_at <= v_now then return null; end if;
  if operation.stage = 'prepared' then
    if exists(select 1 from public.capture_external_work_admissions
        where owner_id = p_owner_id and lease_expires_at > v_now) then
      raise exception 'external work active';
    end if;
    if exists(select 1 from public.capture_external_capabilities
        where owner_id = p_owner_id and expires_at > v_now) then
      raise exception 'unexpired external capability';
    end if;
    update public.capture_account_erasure_operations set
      stage = 'polar', confirmed_at = v_now, version = version + 1,
      retry_after = v_now, updated_at = v_now
      where operation_id = p_operation_id returning * into operation;
    -- The operation row and entitlement revocation commit together. Every other
    -- write path also checks capture_account_write_allowed inside its own transaction.
    update public.capture_cloud_subscriptions set
      is_entitled = false, access_expires_at = v_now,
      reconciliation_required = false, state_version = state_version + 1,
      updated_at = v_now
      where user_id = p_owner_id;
  end if;
  return jsonb_build_object(
    'operationId', operation.operation_id, 'ownerId', operation.owner_id,
    'stage', operation.stage, 'version', operation.version,
    'attemptCount', operation.attempt_count, 'retryCount', operation.retry_count,
    'retryAfter', operation.retry_after, 'lastErrorCode', operation.last_error_code,
    'leaseId', operation.lease_id, 'leaseExpiresAt', operation.lease_expires_at,
    'confirmedAt', operation.confirmed_at, 'completedAt', operation.completed_at,
    'receiptExpiresAt', operation.receipt_expires_at
  );
end;
$$;

create or replace function public.claim_capture_account_erasure(
  p_lease_id uuid,
  p_now timestamptz,
  p_lease_expires_at timestamptz
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare operation public.capture_account_erasure_operations%rowtype;
begin
  if p_lease_expires_at <= p_now or p_lease_expires_at > p_now + interval '60 seconds' then
    raise exception 'invalid erasure lease';
  end if;
  perform public.cleanup_capture_account_erasure_receipts();
  select * into operation from public.capture_account_erasure_operations
    where stage not in ('prepared','complete')
      and (retry_after is null or retry_after <= p_now)
      and (lease_expires_at is null or lease_expires_at <= p_now)
    order by created_at asc
    for update skip locked limit 1;
  if not found then return null; end if;
  update public.capture_account_erasure_operations set
    lease_id = p_lease_id, lease_expires_at = p_lease_expires_at,
    attempt_count = attempt_count + 1, version = version + 1,
    updated_at = p_now
    where operation_id = operation.operation_id returning * into operation;
  return jsonb_build_object(
    'operationId', operation.operation_id, 'ownerId', operation.owner_id,
    'stage', operation.stage, 'version', operation.version,
    'attemptCount', operation.attempt_count, 'retryCount', operation.retry_count,
    'retryAfter', operation.retry_after, 'lastErrorCode', operation.last_error_code,
    'leaseId', operation.lease_id, 'leaseExpiresAt', operation.lease_expires_at,
    'confirmedAt', operation.confirmed_at, 'completedAt', operation.completed_at,
    'receiptExpiresAt', operation.receipt_expires_at
  );
end;
$$;

create or replace function public.advance_capture_account_erasure(
  p_operation_id uuid,
  p_owner_id uuid,
  p_lease_id uuid,
  p_version bigint,
  p_stage text,
  p_next_stage text,
  p_now timestamptz
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare operation public.capture_account_erasure_operations%rowtype;
begin
  if (p_stage, p_next_stage) not in (
    ('polar','sessions'), ('sessions','storage'), ('storage','app_rows'),
    ('app_rows','auth'), ('auth','complete')
  ) then raise exception 'invalid erasure transition'; end if;
  select * into operation from public.capture_account_erasure_operations
    where operation_id = p_operation_id for update;
  if not found or (operation.owner_id is distinct from p_owner_id and not (p_stage = 'auth' and operation.owner_id is null))
     or operation.lease_id is distinct from p_lease_id
     or operation.version <> p_version or operation.stage <> p_stage then return false; end if;
  if exists(select 1 from public.capture_external_work_admissions
      where owner_id = p_owner_id and lease_expires_at > clock_timestamp()) then
    raise exception 'external work active';
  end if;
  update public.capture_account_erasure_operations set
    stage = p_next_stage, owner_id = case when p_next_stage = 'complete' then null else owner_id end,
    session_id_hash = case when p_next_stage = 'complete' then null else session_id_hash end,
    completed_at = case when p_next_stage = 'complete' then p_now else completed_at end,
    receipt_expires_at = case when p_next_stage = 'complete' then p_now + interval '30 days' else receipt_expires_at end,
    lease_id = null, lease_expires_at = null, retry_after = null, last_error_code = null,
    version = version + 1, updated_at = p_now
    where operation_id = p_operation_id;
  return true;
end;
$$;

create or replace function public.authorize_capture_account_auth_deletion(
  p_operation_id uuid,
  p_owner_id uuid,
  p_lease_id uuid,
  p_version bigint
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare operation public.capture_account_erasure_operations%rowtype;
begin
  perform public.capture_account_owner_lock(p_owner_id);
  delete from public.capture_external_work_admissions
    where owner_id = p_owner_id and lease_expires_at <= clock_timestamp();
  delete from public.capture_external_capabilities
    where owner_id = p_owner_id and expires_at <= clock_timestamp();
  select * into operation from public.capture_account_erasure_operations
    where operation_id = p_operation_id for update;
  if not found or operation.owner_id is distinct from p_owner_id
     or operation.lease_id is distinct from p_lease_id
     or operation.version <> p_version or operation.stage <> 'auth'
     or exists(select 1 from public.capture_external_work_admissions
       where owner_id = p_owner_id and lease_expires_at > clock_timestamp())
     or exists(select 1 from public.capture_external_capabilities
       where owner_id = p_owner_id and expires_at > clock_timestamp()) then
    return false;
  end if;
  return true;
end;
$$;

create or replace function public.fail_capture_account_erasure(
  p_operation_id uuid,
  p_owner_id uuid,
  p_lease_id uuid,
  p_version bigint,
  p_stage text,
  p_error_code text,
  p_retry_after timestamptz
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_stage not in ('polar','sessions','storage','app_rows','auth')
     or p_error_code !~ '^[a-z0-9_]{1,64}$'
     or p_retry_after <= clock_timestamp()
     or p_retry_after > clock_timestamp() + interval '1 hour' then
    raise exception 'invalid erasure retry';
  end if;
  update public.capture_account_erasure_operations set
    retry_count = retry_count + 1, retry_after = p_retry_after,
    last_error_code = p_error_code, lease_id = null, lease_expires_at = null,
    version = version + 1, updated_at = clock_timestamp()
    where operation_id = p_operation_id and owner_id = p_owner_id
      and lease_id = p_lease_id and version = p_version and stage = p_stage;
  return found;
end;
$$;

revoke all on function public.cleanup_capture_account_erasure_receipts() from public, anon, authenticated;
revoke all on function public.prepare_capture_account_erasure(uuid,uuid,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.status_capture_account_erasure(uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.confirm_capture_account_erasure(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.claim_capture_account_erasure(uuid,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.advance_capture_account_erasure(uuid,uuid,uuid,bigint,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.authorize_capture_account_auth_deletion(uuid,uuid,uuid,bigint) from public, anon, authenticated;
revoke all on function public.fail_capture_account_erasure(uuid,uuid,uuid,bigint,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.cleanup_capture_account_erasure_receipts() to service_role;
grant execute on function public.prepare_capture_account_erasure(uuid,uuid,text,text,timestamptz) to service_role;
grant execute on function public.status_capture_account_erasure(uuid,text,uuid,text) to service_role;
grant execute on function public.confirm_capture_account_erasure(uuid,uuid,text,text) to service_role;
grant execute on function public.claim_capture_account_erasure(uuid,timestamptz,timestamptz) to service_role;
grant execute on function public.advance_capture_account_erasure(uuid,uuid,uuid,bigint,text,text,timestamptz) to service_role;
grant execute on function public.authorize_capture_account_auth_deletion(uuid,uuid,uuid,bigint) to service_role;
grant execute on function public.fail_capture_account_erasure(uuid,uuid,uuid,bigint,text,text,timestamptz) to service_role;

-- Prepared exact-owner reads remain available. Confirmation fences reads and writes.
drop policy if exists capture_boards_erasure_read_fence on public.capture_boards;
create policy capture_boards_erasure_read_fence on public.capture_boards
  as restrictive for select to authenticated
  using ((select auth.uid()) = user_id and public.capture_account_read_allowed((select auth.uid())));
drop policy if exists capture_cloud_subscriptions_erasure_read_fence on public.capture_cloud_subscriptions;
create policy capture_cloud_subscriptions_erasure_read_fence on public.capture_cloud_subscriptions
  as restrictive for select to authenticated
  using ((select auth.uid()) = user_id and public.capture_account_read_allowed((select auth.uid())));
drop policy if exists capture_boards_insert on public.capture_boards;
create policy capture_boards_insert on public.capture_boards for insert to authenticated
  with check ((select auth.uid()) = user_id and public.capture_account_write_allowed((select auth.uid())));
drop policy if exists capture_boards_update on public.capture_boards;
create policy capture_boards_update on public.capture_boards for update to authenticated
  using ((select auth.uid()) = user_id and public.capture_account_write_allowed((select auth.uid())))
  with check ((select auth.uid()) = user_id and public.capture_account_write_allowed((select auth.uid())));
drop policy if exists capture_boards_delete on public.capture_boards;
create policy capture_boards_delete on public.capture_boards for delete to authenticated
  using ((select auth.uid()) = user_id and public.capture_account_write_allowed((select auth.uid())));

-- Add restrictive fences alongside the reviewed publication/Storage policies.
-- Fresh activation fingerprints publication/fresh Storage policies. Hold and
-- re-attest the app-owned activation while those definitions change.
do $$ begin
  if to_regclass('public.capture_image_fresh_activation') is not null then
    lock table public.capture_image_fresh_activation in access exclusive mode;
    drop trigger if exists capture_image_fresh_fixed on public.capture_image_fresh_activation;
  end if;
end $$;
drop policy if exists capture_image_publication_erasure_fence on public.capture_image_publications;
create policy capture_image_publication_erasure_fence on public.capture_image_publications
  as restrictive for insert to authenticated
  with check (public.capture_account_write_allowed((select auth.uid())));
drop policy if exists capture_image_publication_erasure_read_fence on public.capture_image_publications;
create policy capture_image_publication_erasure_read_fence on public.capture_image_publications
  as restrictive for select to authenticated
  using ((select auth.uid()) = user_id and public.capture_account_read_allowed((select auth.uid())));
drop policy if exists capture_storage_erasure_read_fence on storage.objects;
create policy capture_storage_erasure_read_fence on storage.objects
  as restrictive for select to authenticated
  using (bucket_id not in ('capture-images','capture-image-candidates','capture-image-candidates-fresh-20260914')
    or (pg_catalog.split_part(name,'/',1) = (select auth.uid())::text
      and public.capture_account_read_allowed((select auth.uid()))));
drop policy if exists capture_images_write_erasure_fence on storage.objects;
create policy capture_images_write_erasure_fence on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'capture-images' or public.capture_account_write_allowed((select auth.uid())));
drop policy if exists capture_candidates_write_erasure_fence on storage.objects;
create policy capture_candidates_write_erasure_fence on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'capture-image-candidates' or public.capture_account_write_allowed((select auth.uid())));
drop policy if exists capture_fresh_write_erasure_fence on storage.objects;
create policy capture_fresh_write_erasure_fence on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'capture-image-candidates-fresh-20260914' or public.capture_account_write_allowed((select auth.uid())));

-- The immutable publication insert trigger is a second admission boundary.
create or replace function public.capture_image_erasure_guard_fn() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.capture_account_write_allowed(new.user_id) then
    raise insufficient_privilege using message = 'account write fenced';
  end if;
  return new;
end;
$$;
revoke all on function public.capture_image_erasure_guard_fn() from public, anon, authenticated;
drop trigger if exists capture_image_erasure_guard on public.capture_image_publications;
create trigger capture_image_erasure_guard before insert on public.capture_image_publications
  for each row execute function public.capture_image_erasure_guard_fn();

do $$ begin
  if to_regclass('public.capture_image_fresh_activation') is not null then
    update public.capture_image_fresh_activation
      set policy_fingerprint = public.capture_image_fresh_policy_fingerprint()
      where singleton;
    create trigger capture_image_fresh_fixed
      before insert or update or delete on public.capture_image_fresh_activation
      for each row execute function public.capture_image_fresh_fixed_fn();
    if not public.capture_image_publication_ready() then
      raise exception 'Erasure-fence image activation failed';
    end if;
  end if;
end $$;

-- Quota consumption is itself an owner mutation. Replace the scope-only RPC with
-- the same policy-owned implementation plus the lifecycle check.
create or replace function public.consume_capture_cloud_quota(p_scope text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_window_started_at timestamptz; v_request_count integer;
  v_limit integer; v_window_seconds integer;
begin
  if v_user_id is null or not public.capture_account_write_allowed(v_user_id) then
    raise insufficient_privilege using message = 'owner unavailable';
  end if;
  select policy.request_limit, policy.window_seconds into v_limit, v_window_seconds
    from public.capture_cloud_quota_policies policy where policy.scope = p_scope;
  if not found then raise exception 'invalid quota scope'; end if;
  perform 1 from auth.users where id = v_user_id for key share;
  if not found then raise insufficient_privilege using message = 'owner unavailable'; end if;
  insert into public.capture_cloud_owner_quotas as quota(user_id,scope,window_started_at,request_count,updated_at)
    values(v_user_id,p_scope,v_now,1,v_now)
  on conflict(user_id,scope) do update set
    window_started_at = case when quota.window_started_at + pg_catalog.make_interval(secs => v_window_seconds) <= v_now then v_now else quota.window_started_at end,
    request_count = case when quota.window_started_at + pg_catalog.make_interval(secs => v_window_seconds) <= v_now then 1 else quota.request_count + 1 end,
    updated_at = v_now
  where quota.window_started_at + pg_catalog.make_interval(secs => v_window_seconds) <= v_now or quota.request_count < v_limit
  returning window_started_at,request_count into v_window_started_at,v_request_count;
  if found then return jsonb_build_object('allowed',true,'retryAfterSec',0); end if;
  select quota.window_started_at,quota.request_count into v_window_started_at,v_request_count
    from public.capture_cloud_owner_quotas quota where quota.user_id=v_user_id and quota.scope=p_scope;
  return jsonb_build_object('allowed',false,'retryAfterSec',greatest(1,pg_catalog.ceil(extract(epoch from
    (v_window_started_at + pg_catalog.make_interval(secs => v_window_seconds) - v_now)))::integer));
end;
$$;
revoke all on function public.consume_capture_cloud_quota(text) from public, anon;
grant execute on function public.consume_capture_cloud_quota(text) to authenticated;

-- Any signed Polar activity after a completed sweep invalidates that sweep.
-- The webhook transaction rewinds and clears the worker lease before it can
-- acknowledge the delivery, so a stale worker cannot advance or complete.
create or replace function public.rewind_capture_account_erasure_to_polar(p_owner_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare operation public.capture_account_erasure_operations%rowtype;
begin
  perform public.capture_account_owner_lock(p_owner_id);
  select * into operation from public.capture_account_erasure_operations
    where owner_id = p_owner_id and stage not in ('prepared','complete') for update;
  if not found then return false; end if;
  update public.capture_account_erasure_operations set
    stage='polar', lease_id=null, lease_expires_at=null,
    retry_after=clock_timestamp(), last_error_code='late_polar_activity',
    version=version+1, updated_at=clock_timestamp()
    where operation_id=operation.operation_id;
  return true;
end;
$$;
revoke all on function public.rewind_capture_account_erasure_to_polar(uuid) from public, anon, authenticated;
grant execute on function public.rewind_capture_account_erasure_to_polar(uuid) to service_role;

-- Private base: the production wrapper below owns subscription serialization,
-- the observed owner's advisory lock, and any existing subscription row lock.
-- Signed late deliveries stay deduplicated but cannot recreate access.
create or replace function public.apply_polar_subscription_event_base(
  p_event_id text, p_event_type text, p_event_created_at timestamptz, p_user_id uuid,
  p_status text, p_plan text, p_is_entitled boolean, p_polar_customer_id text,
  p_polar_subscription_id text, p_polar_product_id text,
  p_current_period_start timestamptz, p_current_period_end timestamptz,
  p_access_expires_at timestamptz, p_cancel_at_period_end boolean
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('trialing','active','past_due','canceled','revoked','paused','inactive')
     or (p_plan is not null and p_plan not in ('monthly','yearly'))
     or p_event_id = '' or p_polar_subscription_id = '' or p_polar_customer_id = '' then
    raise exception 'invalid subscription event';
  end if;
  if exists(select 1 from public.capture_cloud_subscriptions where polar_subscription_id=p_polar_subscription_id
    and (user_id<>p_user_id or polar_customer_id<>p_polar_customer_id)) then
    raise exception 'polar subscription ownership mismatch';
  end if;
  perform 1 from auth.users where id=p_user_id for key share;
  if not found then
    insert into public.polar_webhook_events(event_id,event_type,user_id,polar_subscription_id,event_created_at)
      values(p_event_id,p_event_type,null,p_polar_subscription_id,p_event_created_at) on conflict(event_id) do nothing;
    return false;
  end if;
  insert into public.polar_webhook_events(event_id,event_type,user_id,polar_subscription_id,event_created_at)
    values(p_event_id,p_event_type,p_user_id,p_polar_subscription_id,p_event_created_at) on conflict(event_id) do nothing;
  if not found then return false; end if;
  if not public.capture_account_write_allowed(p_user_id) then
    update public.capture_cloud_subscriptions set is_entitled=false, access_expires_at=clock_timestamp(),
      reconciliation_required=false, state_version=state_version+1, updated_at=clock_timestamp()
      where polar_subscription_id=p_polar_subscription_id and user_id=p_user_id;
    return true;
  end if;
  insert into public.capture_cloud_subscriptions(
    polar_subscription_id,user_id,status,plan,is_entitled,polar_customer_id,polar_product_id,
    current_period_start,current_period_end,access_expires_at,cancel_at_period_end,last_event_at,updated_at
  ) values (
    p_polar_subscription_id,p_user_id,p_status,p_plan,p_is_entitled,p_polar_customer_id,p_polar_product_id,
    p_current_period_start,p_current_period_end,p_access_expires_at,p_cancel_at_period_end,p_event_created_at,now()
  ) on conflict(polar_subscription_id) do update set status=excluded.status,plan=excluded.plan,
    is_entitled=excluded.is_entitled,polar_product_id=excluded.polar_product_id,
    current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
    access_expires_at=excluded.access_expires_at,cancel_at_period_end=excluded.cancel_at_period_end,
    last_event_at=excluded.last_event_at,updated_at=now()
  where public.capture_cloud_subscriptions.user_id=excluded.user_id
    and public.capture_cloud_subscriptions.polar_customer_id=excluded.polar_customer_id
    and public.capture_cloud_subscriptions.last_event_at<excluded.last_event_at;
  return true;
end;
$$;
revoke all on function public.apply_polar_subscription_event_base(text,text,timestamptz,uuid,text,text,boolean,text,text,text,timestamptz,timestamptz,timestamptz,boolean) from public, anon, authenticated, service_role;

-- Keep the public webhook signature and the reconciliation wrapper semantics
-- from 20260913210000_polar_review_guards.sql, but extend its lock contract for
-- erasure. The immutable observed owner is resolved under subscription-ID
-- serialization, then its owner lock is acquired before the subscription row.
-- Confirmation takes owner -> subscription in that same order. Once both are
-- held, re-read and verify the binding before rewinding or applying the event.
create or replace function public.apply_polar_subscription_event(
  p_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_user_id uuid,
  p_status text,
  p_plan text,
  p_is_entitled boolean,
  p_polar_customer_id text,
  p_polar_subscription_id text,
  p_polar_product_id text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_access_expires_at timestamptz,
  p_cancel_at_period_end boolean
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous public.capture_cloud_subscriptions%rowtype;
  applied boolean;
  ambiguous boolean := false;
  observed_owner uuid;
  subscription_found boolean := false;
begin
  observed_owner := public.lock_polar_parent(p_polar_subscription_id, p_user_id);
  -- A missing/null identity has no owner lock or subscription row to protect.
  -- The private base preserves the existing null-owner receipt behavior.
  if observed_owner is null then
    return public.apply_polar_subscription_event_base(
      p_event_id, p_event_type, p_event_created_at, p_user_id, p_status, p_plan,
      p_is_entitled, p_polar_customer_id, p_polar_subscription_id, p_polar_product_id,
      p_current_period_start, p_current_period_end, p_access_expires_at, p_cancel_at_period_end);
  end if;

  perform public.capture_account_owner_lock(observed_owner);
  select * into previous from public.capture_cloud_subscriptions
    where polar_subscription_id = p_polar_subscription_id for update;
  subscription_found := found;

  if observed_owner is distinct from p_user_id
      or (subscription_found and (
        previous.user_id is distinct from observed_owner
        or previous.polar_customer_id is distinct from p_polar_customer_id
      )) then
    return public.queue_invalid_polar_event(
      p_polar_subscription_id, p_event_id, p_event_type, p_event_created_at);
  end if;

  -- Match the base's validation before rewind so malformed matching events have
  -- no erasure side effect. Ownership-mismatch deliveries retain the reviewed
  -- invalid-event queue behavior above.
  if p_status not in ('trialing','active','past_due','canceled','revoked','paused','inactive')
     or (p_plan is not null and p_plan not in ('monthly','yearly'))
     or p_event_id = '' or p_polar_subscription_id = '' or p_polar_customer_id = '' then
    raise exception 'invalid subscription event';
  end if;

  perform public.rewind_capture_account_erasure_to_polar(observed_owner);
  if subscription_found and previous.last_event_at = p_event_created_at then
    ambiguous := row(previous.status, previous.plan, previous.is_entitled,
      previous.polar_product_id, previous.current_period_start, previous.current_period_end,
      previous.access_expires_at, previous.cancel_at_period_end)
      is distinct from row(p_status, p_plan, p_is_entitled, p_polar_product_id,
      p_current_period_start, p_current_period_end, p_access_expires_at, p_cancel_at_period_end);
  end if;

  applied := public.apply_polar_subscription_event_base(
    p_event_id, p_event_type, p_event_created_at, p_user_id, p_status, p_plan,
    p_is_entitled, p_polar_customer_id, p_polar_subscription_id, p_polar_product_id,
    p_current_period_start, p_current_period_end, p_access_expires_at, p_cancel_at_period_end);
  -- A duplicate never bumps the version, but the caller MUST still retry any
  -- pending reconciliation: ledgered does not mean authoritatively resolved.
  if applied and (not subscription_found or p_event_created_at >= previous.last_event_at) then
    update public.capture_cloud_subscriptions set
      state_version = state_version + 1,
      authoritative_mode = authoritative_mode or ambiguous,
      reconciliation_required = authoritative_mode or ambiguous,
      is_entitled = case when authoritative_mode or ambiguous then false else is_entitled end,
      reconcile_after = case when authoritative_mode or ambiguous then '-infinity'::timestamptz else reconcile_after end
    where polar_subscription_id = p_polar_subscription_id;
  end if;
  return applied;
end;
$$;
revoke all on function public.apply_polar_subscription_event(text,text,timestamptz,uuid,text,text,boolean,text,text,text,timestamptz,timestamptz,timestamptz,boolean) from public, anon, authenticated;
grant execute on function public.apply_polar_subscription_event(text,text,timestamptz,uuid,text,text,boolean,text,text,text,timestamptz,timestamptz,timestamptz,boolean) to service_role;

create or replace function public.queue_invalid_polar_event(
  p_subscription_id text,p_event_id text,p_event_type text,p_event_created_at timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  s public.capture_cloud_subscriptions%rowtype;
  observed_owner uuid;
begin
  observed_owner := public.lock_polar_parent(p_subscription_id);
  if observed_owner is null then
    insert into public.polar_webhook_events(event_id,event_type,user_id,polar_subscription_id,event_created_at)
      values(p_event_id,p_event_type,null,p_subscription_id,p_event_created_at) on conflict(event_id) do nothing;
    return false;
  end if;
  perform public.capture_account_owner_lock(observed_owner);
  select * into s from public.capture_cloud_subscriptions where polar_subscription_id=p_subscription_id for update;
  if not found or s.user_id is distinct from observed_owner then
    raise exception 'polar subscription owner changed';
  end if;
  insert into public.polar_webhook_events(event_id,event_type,user_id,polar_subscription_id,event_created_at)
    values(p_event_id,p_event_type,s.user_id,p_subscription_id,p_event_created_at) on conflict(event_id) do nothing;
  if not public.capture_account_write_allowed(s.user_id) then
    perform public.rewind_capture_account_erasure_to_polar(s.user_id);
    update public.capture_cloud_subscriptions set is_entitled=false,reconciliation_required=false,
      state_version=state_version+1,updated_at=clock_timestamp() where polar_subscription_id=p_subscription_id;
    return true;
  end if;
  if found and p_event_created_at>=s.last_event_at then
    update public.capture_cloud_subscriptions set is_entitled=false,reconciliation_required=true,
      authoritative_mode=true,state_version=state_version+1,reconcile_after='-infinity',
      last_event_at=p_event_created_at,updated_at=now() where polar_subscription_id=p_subscription_id;
  end if;
  return true;
end;
$$;
revoke all on function public.queue_invalid_polar_event(text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.queue_invalid_polar_event(text,text,text,timestamptz) to service_role;

create or replace function public.claim_polar_reconciliation(p_subscription_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.capture_cloud_subscriptions%rowtype;
  observed_owner uuid;
begin
  observed_owner := public.lock_polar_parent(p_subscription_id);
  if observed_owner is null then return jsonb_build_object('pending',false); end if;
  perform public.capture_account_owner_lock(observed_owner);
  select * into s from public.capture_cloud_subscriptions where polar_subscription_id=p_subscription_id for update;
  if not found then return jsonb_build_object('pending',false); end if;
  if s.user_id is distinct from observed_owner then raise exception 'polar subscription owner changed'; end if;
  if not s.reconciliation_required then return jsonb_build_object('pending',false); end if;
  if not public.capture_account_write_allowed(s.user_id) then
    update public.capture_cloud_subscriptions set is_entitled=false,reconciliation_required=false,
      state_version=state_version+1,updated_at=clock_timestamp() where polar_subscription_id=p_subscription_id;
    return jsonb_build_object('pending',false);
  end if;
  if s.reconcile_after>now() then return jsonb_build_object('pending',true); end if;
  update public.capture_cloud_subscriptions set state_version=state_version+1,reconcile_after=now()+interval '30 seconds'
    where polar_subscription_id=p_subscription_id returning * into s;
  return jsonb_build_object('pending',true,'version',s.state_version::text,'userId',s.user_id,
    'customerId',s.polar_customer_id,'productId',s.polar_product_id);
end;
$$;

create or replace function public.finish_polar_reconciliation(
  p_subscription_id text,p_version bigint,p_snapshot jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  s public.capture_cloud_subscriptions%rowtype;
  observed_owner uuid;
begin
  observed_owner := public.lock_polar_parent(p_subscription_id);
  if observed_owner is null then return false; end if;
  perform public.capture_account_owner_lock(observed_owner);
  select * into s from public.capture_cloud_subscriptions where polar_subscription_id=p_subscription_id for update;
  if not found then return false; end if;
  if s.user_id is distinct from observed_owner then raise exception 'polar subscription owner changed'; end if;
  if not s.reconciliation_required or s.state_version<>p_version then return false; end if;
  if not public.capture_account_write_allowed(s.user_id) then
    update public.capture_cloud_subscriptions set is_entitled=false,reconciliation_required=false,
      state_version=state_version+1,updated_at=clock_timestamp() where polar_subscription_id=p_subscription_id;
    return false;
  end if;
  if p_snapshot->>'polarSubscriptionId' is distinct from p_subscription_id
     or p_snapshot->>'userId' is distinct from s.user_id::text
     or p_snapshot->>'polarCustomerId' is distinct from s.polar_customer_id then
    raise exception 'polar reconciliation binding mismatch';
  end if;
  update public.capture_cloud_subscriptions set status=p_snapshot->>'status',plan=p_snapshot->>'plan',
    polar_product_id=p_snapshot->>'polarProductId',is_entitled=(p_snapshot->>'isEntitled')::boolean,
    current_period_start=(p_snapshot->>'currentPeriodStart')::timestamptz,
    current_period_end=(p_snapshot->>'currentPeriodEnd')::timestamptz,
    access_expires_at=(p_snapshot->>'accessExpiresAt')::timestamptz,
    cancel_at_period_end=(p_snapshot->>'cancelAtPeriodEnd')::boolean,
    reconciliation_required=false,state_version=state_version+1,updated_at=now()
    where polar_subscription_id=p_subscription_id;
  return true;
end;
$$;
revoke all on function public.claim_polar_reconciliation(text) from public, anon, authenticated;
revoke all on function public.finish_polar_reconciliation(text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.claim_polar_reconciliation(text) to service_role;
grant execute on function public.finish_polar_reconciliation(text,bigint,jsonb) to service_role;

create or replace function public.next_polar_reconciliation(p_user_id uuid) returns text
language sql security definer set search_path = '' as $$
  select polar_subscription_id from public.capture_cloud_subscriptions
  where user_id=p_user_id and public.capture_account_write_allowed(p_user_id)
    and reconciliation_required and reconcile_after<=now()
  order by reconcile_after asc limit 1;
$$;
revoke all on function public.next_polar_reconciliation(uuid) from public, anon, authenticated;
grant execute on function public.next_polar_reconciliation(uuid) to service_role;

-- Application rows are removed only after external billing, sessions and Storage.
create or replace function public.delete_capture_account_app_rows(p_owner_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.capture_account_deleting(p_owner_id) then
    raise insufficient_privilege using message = 'erasure fence required';
  end if;
  -- These two tables are created by the later additive image-admission
  -- migration. Dynamic guarded statements keep this migration independently
  -- additive while ensuring the rows are drained before Auth deletion once the
  -- image schema is present.
  if to_regclass('public.capture_image_operations') is not null then
    execute 'delete from public.capture_image_operations where owner_id=$1' using p_owner_id;
  end if;
  if to_regclass('public.capture_image_owner_usage') is not null then
    execute 'delete from public.capture_image_owner_usage where owner_id=$1' using p_owner_id;
  end if;
  delete from public.capture_cloud_owner_quotas where user_id=p_owner_id;
  delete from public.capture_boards where user_id=p_owner_id;
  delete from public.capture_image_publications where user_id=p_owner_id;
  delete from public.capture_cloud_subscriptions where user_id=p_owner_id;
  delete from public.capture_external_work_admissions where owner_id=p_owner_id;
  delete from public.capture_external_capabilities where owner_id=p_owner_id;
  return true;
end;
$$;
create or replace function public.capture_account_app_rows_exist(p_owner_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_exists boolean;
begin
  if to_regclass('public.capture_image_operations') is not null then
    execute 'select exists(select 1 from public.capture_image_operations where owner_id=$1)'
      into v_exists using p_owner_id;
    if v_exists then return true; end if;
  end if;
  if to_regclass('public.capture_image_owner_usage') is not null then
    execute 'select exists(select 1 from public.capture_image_owner_usage where owner_id=$1)'
      into v_exists using p_owner_id;
    if v_exists then return true; end if;
  end if;
  return exists(select 1 from public.capture_boards where user_id=p_owner_id)
    or exists(select 1 from public.capture_image_publications where user_id=p_owner_id)
    or exists(select 1 from public.capture_cloud_owner_quotas where user_id=p_owner_id)
    or exists(select 1 from public.capture_cloud_subscriptions where user_id=p_owner_id)
    or exists(select 1 from public.capture_external_work_admissions where owner_id=p_owner_id)
    or exists(select 1 from public.capture_external_capabilities where owner_id=p_owner_id);
end;
$$;
revoke all on function public.delete_capture_account_app_rows(uuid) from public, anon, authenticated;
revoke all on function public.capture_account_app_rows_exist(uuid) from public, anon, authenticated;
grant execute on function public.delete_capture_account_app_rows(uuid) to service_role;
grant execute on function public.capture_account_app_rows_exist(uuid) to service_role;

commit;
