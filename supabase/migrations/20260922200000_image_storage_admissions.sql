-- Capture Cloud image admission: app-owned physical-object reservations,
-- generated candidate paths, durable inventory, and service-only publication.
-- Hosted Storage policy semantics and provider quiescence still require separate
-- attestation before rollout; stale provider-facing reservations fail closed.
begin;
set local lock_timeout = '10s';

do $$ begin
  if to_regclass('public.capture_image_publications') is null
     or to_regprocedure('public.capture_image_publication_ready()') is null
     or to_regprocedure('public.capture_image_publication_config()') is null
     or to_regprocedure('public.capture_account_owner_lock(uuid)') is null
     or to_regprocedure('public.capture_account_write_allowed(uuid)') is null
     or to_regclass('public.capture_external_work_admissions') is null then
    raise exception 'Image publication and account-erasure prerequisites required';
  end if;
end $$;

create temporary table capture_image_upgrade_config(value jsonb) on commit drop;
insert into capture_image_upgrade_config(value)
  select public.capture_image_publication_config();

-- Fresh activation fingerprints its publication/Storage policies. Hold the
-- immutable activation row while the direct INSERT policy is removed, then
-- re-attest and restore its guard in this same transaction.
do $$ begin
  if to_regclass('public.capture_image_fresh_activation') is not null then
    lock table public.capture_image_fresh_activation in access exclusive mode;
    drop trigger if exists capture_image_fresh_fixed on public.capture_image_fresh_activation;
  end if;
end $$;

create table public.capture_image_storage_policy (
  singleton boolean primary key default true check (singleton),
  max_objects integer not null check (max_objects between 1 and 4096),
  max_bytes bigint not null check (max_bytes between 2250000 and 9216000000),
  max_object_bytes integer not null check (max_object_bytes = 2250000),
  lease_seconds integer not null check (lease_seconds between 60 and 600),
  stale_reclaim_enabled boolean not null default false,
  admission_fingerprint text not null default repeat('0',32)
    check (admission_fingerprint ~ '^[0-9a-f]{32}$'),
  updated_at timestamptz not null default clock_timestamp(),
  check (max_bytes <= max_objects::bigint * max_object_bytes::bigint)
);
insert into public.capture_image_storage_policy(
  singleton,max_objects,max_bytes,max_object_bytes,lease_seconds
) values (true, 256, 576000000, 2250000, 120);
alter table public.capture_image_storage_policy enable row level security;
revoke all on table public.capture_image_storage_policy from public, anon, authenticated;
grant select, update on table public.capture_image_storage_policy to service_role;

create table public.capture_image_owner_usage (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  reserved_objects integer not null check (reserved_objects between 0 and 4096),
  reserved_bytes bigint not null check (reserved_bytes between 0 and 9216000000),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.capture_image_owner_usage enable row level security;
revoke all on table public.capture_image_owner_usage from public, anon, authenticated;
grant select, insert, update, delete on table public.capture_image_owner_usage to service_role;

create table public.capture_image_operations (
  operation_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  image_id text not null check (image_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  candidate_id uuid not null default gen_random_uuid(),
  bucket_id text not null check (bucket_id in (
    'capture-image-candidates','capture-image-candidates-fresh-20260914'
  )),
  object_path text generated always as (owner_id::text || '/' || candidate_id::text) stored,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  content_type text not null check (content_type in ('image/png','image/jpeg','image/webp','image/gif')),
  byte_size integer not null check (byte_size between 1 and 2250000),
  state text not null check (state in ('reserved','uploaded','published','abandoned','released','deleted')),
  lease_id uuid not null default gen_random_uuid(),
  lease_expires_at timestamptz not null,
  operation_version bigint not null default 0 check (operation_version >= 0),
  reconciliation_lease_id uuid,
  reconciliation_lease_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  finalized_at timestamptz,
  unique(owner_id,bucket_id,candidate_id),
  check ((reconciliation_lease_id is null) = (reconciliation_lease_expires_at is null)),
  check ((state in ('published','abandoned','released','deleted')) = (finalized_at is not null))
);
create index capture_image_operations_owner_inventory
  on public.capture_image_operations(owner_id,state,created_at,operation_id);
create index capture_image_operations_stale
  on public.capture_image_operations(lease_expires_at,created_at)
  where state in ('reserved','uploaded','abandoned');
alter table public.capture_image_operations enable row level security;
revoke all on table public.capture_image_operations from public, anon, authenticated;
grant select, insert, update, delete on table public.capture_image_operations to service_role;

-- Upgrade existing durable winners into the accounting ledger before closing
-- browser INSERT. Pre-existing losing/orphan objects remain discoverable only
-- through provider Storage inventory and therefore remain an explicit hosted
-- erasure/quiescence attestation obligation.
do $$
declare v_config jsonb:=(select value from capture_image_upgrade_config); v_bucket text;
begin
  v_bucket:=v_config->>'bucket';
  if (v_config->>'mode',v_bucket) not in (
    ('legacy-cutover','capture-image-candidates'),
    ('fresh','capture-image-candidates-fresh-20260914')
  ) then raise exception 'Image publication configuration mismatch during ledger upgrade'; end if;
  insert into public.capture_image_operations(
    owner_id,image_id,candidate_id,bucket_id,sha256,content_type,byte_size,
    state,lease_expires_at,finalized_at
  ) select publication.user_id,publication.image_id,publication.candidate_id,v_bucket,
      publication.sha256,publication.content_type,publication.byte_size,
      'published',clock_timestamp(),clock_timestamp()
    from public.capture_image_publications publication;
  insert into public.capture_image_owner_usage(owner_id,reserved_objects,reserved_bytes)
    select operation.owner_id,count(*)::integer,sum(operation.byte_size)::bigint
    from public.capture_image_operations operation
    where operation.state not in ('released','deleted') group by operation.owner_id;
end $$;

-- Image uploads participate in the same owner-bound external-work fence as AI
-- and billing. Confirmation removes only expired admissions; a live upload
-- therefore wins or loses atomically against account-erasure confirmation.
alter table public.capture_external_work_admissions
  drop constraint if exists capture_external_work_admissions_kind_check;
alter table public.capture_external_work_admissions
  add constraint capture_external_work_admissions_kind_check
  check (kind in ('managed_ai','polar_checkout','polar_portal','polar_reconcile','image_upload'));

create function public.reserve_capture_image_storage(
  p_owner_id uuid,
  p_image_id text,
  p_sha256 text,
  p_content_type text,
  p_byte_size integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  policy public.capture_image_storage_policy%rowtype;
  v_usage public.capture_image_owner_usage%rowtype;
  operation public.capture_image_operations%rowtype;
  publication public.capture_image_publications%rowtype;
  v_config jsonb;
  v_bucket text;
  v_now timestamptz := clock_timestamp();
begin
  if p_owner_id is null or p_image_id !~ '^[A-Za-z0-9_-]{1,64}$'
     or p_sha256 !~ '^[0-9a-f]{64}$'
     or p_content_type not in ('image/png','image/jpeg','image/webp','image/gif')
     or p_byte_size is null or p_byte_size < 1 then
    raise exception 'invalid image reservation';
  end if;
  perform public.capture_account_owner_lock(p_owner_id);
  if not public.capture_account_write_allowed(p_owner_id) then
    raise insufficient_privilege using message = 'account write fenced';
  end if;
  perform 1 from auth.users where id=p_owner_id for key share;
  if not found then raise insufficient_privilege using message='owner unavailable'; end if;
  if not exists(select 1 from public.capture_cloud_subscriptions subscription
    where subscription.user_id=p_owner_id and subscription.is_entitled
      and subscription.access_expires_at>v_now) then
    raise insufficient_privilege using message='image entitlement required';
  end if;
  select * into policy from public.capture_image_storage_policy where singleton for share;
  if not found or p_byte_size>policy.max_object_bytes then
    raise exception 'image reservation policy unavailable';
  end if;
  if not public.capture_image_publication_ready() then
    raise exception 'image publication unavailable';
  end if;
  v_config := public.capture_image_publication_config();
  v_bucket := v_config->>'bucket';
  if (v_config->>'mode',v_bucket) not in (
    ('legacy-cutover','capture-image-candidates'),
    ('fresh','capture-image-candidates-fresh-20260914')
  ) then raise exception 'image publication configuration mismatch'; end if;

  select * into publication from public.capture_image_publications
    where user_id=p_owner_id and image_id=p_image_id;
  if found then
    return jsonb_build_object('status','published','candidateId',publication.candidate_id,
      'sha256',publication.sha256,'contentType',publication.content_type,
      'byteSize',publication.byte_size,'bucket',v_bucket,
      'objectPath',p_owner_id::text||'/'||publication.candidate_id::text);
  end if;

  -- Expiry reclaims the worker lease, never the physical quota. A completion
  -- admitted before expiry may still arrive; the durable abandoned row remains
  -- enumerable until provider inventory/quiescence is separately proven.
  update public.capture_image_operations set
    state='abandoned', finalized_at=coalesce(finalized_at,v_now),
    operation_version=operation_version+1,
    reconciliation_lease_id=null,reconciliation_lease_expires_at=null,updated_at=v_now
    where owner_id=p_owner_id and state in ('reserved','uploaded') and lease_expires_at<=v_now;
  delete from public.capture_external_work_admissions
    where owner_id=p_owner_id and kind='image_upload' and lease_expires_at<=v_now;

  insert into public.capture_image_owner_usage as usage(
    owner_id,reserved_objects,reserved_bytes,updated_at
  ) values(p_owner_id,1,p_byte_size,v_now)
  on conflict(owner_id) do update set
    reserved_objects=usage.reserved_objects+1,
    reserved_bytes=usage.reserved_bytes+p_byte_size,
    updated_at=v_now
  where usage.reserved_objects + 1 <= policy.max_objects
    and usage.reserved_bytes + p_byte_size <= policy.max_bytes
  returning * into v_usage;
  if not found then
    return jsonb_build_object('status','quota_exceeded');
  end if;

  insert into public.capture_image_operations(
    owner_id,image_id,bucket_id,sha256,content_type,byte_size,state,lease_expires_at
  ) values(
    p_owner_id,p_image_id,v_bucket,p_sha256,p_content_type,p_byte_size,'reserved',
    v_now+pg_catalog.make_interval(secs=>policy.lease_seconds)
  ) returning * into operation;
  insert into public.capture_external_work_admissions(
    admission_id,owner_id,kind,lease_expires_at
  ) values(operation.operation_id,p_owner_id,'image_upload',operation.lease_expires_at);
  return jsonb_build_object('status','reserved','operationId',operation.operation_id,
    'leaseId',operation.lease_id,'leaseExpiresAt',operation.lease_expires_at,
    'candidateId',operation.candidate_id,'bucket',operation.bucket_id,
    'objectPath',operation.object_path,'sha256',operation.sha256,
    'contentType',operation.content_type,'byteSize',operation.byte_size);
end;
$$;

create function public.record_capture_image_storage_upload(
  p_owner_id uuid,p_operation_id uuid,p_lease_id uuid
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform public.capture_account_owner_lock(p_owner_id);
  if not public.capture_account_write_allowed(p_owner_id) then return false; end if;
  update public.capture_image_operations set state='uploaded',
    operation_version=operation_version+1,
    reconciliation_lease_id=null,reconciliation_lease_expires_at=null,
    updated_at=clock_timestamp()
    where operation_id=p_operation_id and owner_id=p_owner_id and lease_id=p_lease_id
      and lease_expires_at>clock_timestamp() and state='reserved';
  if found then return true; end if;
  update public.capture_image_operations set
    operation_version=operation_version+1,
    reconciliation_lease_id=null,reconciliation_lease_expires_at=null,
    updated_at=clock_timestamp()
    where operation_id=p_operation_id and owner_id=p_owner_id and lease_id=p_lease_id
      and state in ('uploaded','published','abandoned')
      and reconciliation_lease_id is not null;
  return exists(select 1 from public.capture_image_operations
    where operation_id=p_operation_id and owner_id=p_owner_id and lease_id=p_lease_id
      and state in ('uploaded','published','abandoned'));
end;
$$;

create function public.release_capture_image_storage_reservation(
  p_owner_id uuid,p_operation_id uuid,p_lease_id uuid
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare operation public.capture_image_operations%rowtype;
begin
  perform public.capture_account_owner_lock(p_owner_id);
  select * into operation from public.capture_image_operations
    where operation_id=p_operation_id and owner_id=p_owner_id for update;
  if not found or operation.lease_id is distinct from p_lease_id then return false; end if;
  if operation.state='released' then
    update public.capture_image_operations set
      operation_version=operation_version+1,
      reconciliation_lease_id=null,reconciliation_lease_expires_at=null,
      updated_at=clock_timestamp()
      where operation_id=operation.operation_id and reconciliation_lease_id is not null;
    return true;
  end if;
  if operation.state<>'reserved' then return false; end if;
  update public.capture_image_operations set state='released',finalized_at=clock_timestamp(),
    operation_version=operation_version+1,
    reconciliation_lease_id=null,reconciliation_lease_expires_at=null,
    updated_at=clock_timestamp() where operation_id=operation.operation_id and state='reserved';
  update public.capture_image_owner_usage as usage set
    reserved_objects=usage.reserved_objects-1,
    reserved_bytes=usage.reserved_bytes-operation.byte_size,
    updated_at=clock_timestamp()
    where owner_id=p_owner_id and usage.reserved_objects>=1
      and usage.reserved_bytes>=operation.byte_size;
  if not found then raise exception 'image usage underflow'; end if;
  delete from public.capture_external_work_admissions
    where admission_id=operation.operation_id and owner_id=p_owner_id and kind='image_upload';
  return true;
end;
$$;

-- Once a provider upload call has started, even typed current absence cannot
-- prove that an already-admitted completion will not arrive later. End the
-- operation as durable abandoned inventory but keep its physical quota and
-- owner-bound external-work admission until the lease boundary.
create function public.abandon_capture_image_storage_reservation(
  p_owner_id uuid,p_operation_id uuid,p_lease_id uuid
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare operation public.capture_image_operations%rowtype;
begin
  perform public.capture_account_owner_lock(p_owner_id);
  select * into operation from public.capture_image_operations
    where operation_id=p_operation_id and owner_id=p_owner_id for update;
  if not found or operation.lease_id is distinct from p_lease_id then return false; end if;
  if operation.state in ('published','abandoned') then
    update public.capture_image_operations set
      operation_version=operation_version+1,
      reconciliation_lease_id=null,reconciliation_lease_expires_at=null,
      updated_at=clock_timestamp()
      where operation_id=operation.operation_id and reconciliation_lease_id is not null;
    return true;
  end if;
  if operation.state not in ('reserved','uploaded') then return false; end if;
  update public.capture_image_operations set state='abandoned',
    finalized_at=coalesce(finalized_at,clock_timestamp()),
    operation_version=operation_version+1,
    reconciliation_lease_id=null,reconciliation_lease_expires_at=null,
    updated_at=clock_timestamp()
    where operation_id=operation.operation_id and state in ('reserved','uploaded');
  return true;
end;
$$;

-- Every publication INSERT, including privileged code, must be bound to the
-- exact durable operation selected by finalize_capture_image_storage.
create function public.capture_image_publication_admission_guard_fn() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_operation_id uuid;
begin
  begin
    v_operation_id := nullif(current_setting('capture.image_operation_id',true),'')::uuid;
  exception when others then
    raise insufficient_privilege using message='image operation required';
  end;
  if v_operation_id is null or not exists(
    select 1 from public.capture_image_operations operation
    where operation.operation_id=v_operation_id and operation.owner_id=new.user_id
      and operation.image_id=new.image_id and operation.candidate_id=new.candidate_id
      and operation.sha256=new.sha256 and operation.content_type=new.content_type
      and operation.byte_size=new.byte_size and operation.state in ('reserved','uploaded')
  ) then raise insufficient_privilege using message='image operation mismatch'; end if;
  return new;
end;
$$;
revoke all on function public.capture_image_publication_admission_guard_fn() from public,anon,authenticated;
drop trigger if exists capture_image_publication_admission_guard on public.capture_image_publications;
create trigger capture_image_publication_admission_guard
  before insert on public.capture_image_publications for each row
  execute function public.capture_image_publication_admission_guard_fn();

-- Legacy mode keeps its collision check but now accepts only the service-owned
-- operation context rather than a direct authenticated INSERT.
create or replace function public.capture_image_legacy_guard_fn() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if nullif(current_setting('capture.image_operation_id',true),'') is null then
    raise insufficient_privilege using message='image operation required';
  end if;
  if not public.capture_image_cutover_verified() then
    raise exception 'image cutover not verified' using errcode='55000';
  end if;
  if exists(select 1 from storage.objects
    where bucket_id='capture-images' and name=new.user_id::text||'/'||new.image_id)
  then raise exception 'legacy image already exists' using errcode='23514'; end if;
  return new;
end;
$$;
revoke all on function public.capture_image_legacy_guard_fn() from public,anon,authenticated;

create function public.finalize_capture_image_storage(
  p_owner_id uuid,p_operation_id uuid,p_lease_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  operation public.capture_image_operations%rowtype;
  winner public.capture_image_publications%rowtype;
  v_now timestamptz:=clock_timestamp();
begin
  perform public.capture_account_owner_lock(p_owner_id);
  select * into operation from public.capture_image_operations
    where operation_id=p_operation_id and owner_id=p_owner_id for update;
  if not found or operation.lease_id is distinct from p_lease_id then
    raise insufficient_privilege using message='image operation unavailable';
  end if;
  if operation.state in ('published','abandoned') then
    update public.capture_image_operations set
      operation_version=operation_version+1,
      reconciliation_lease_id=null,reconciliation_lease_expires_at=null,
      updated_at=v_now
      where operation_id=operation.operation_id and reconciliation_lease_id is not null;
    select * into winner from public.capture_image_publications
      where user_id=p_owner_id and image_id=operation.image_id;
    if not found then raise exception 'image publication missing'; end if;
    return jsonb_build_object('status',operation.state,'winner',
      jsonb_build_object('candidateId',winner.candidate_id,'sha256',winner.sha256,
        'contentType',winner.content_type,'byteSize',winner.byte_size,
        'bucket',operation.bucket_id,'objectPath',p_owner_id::text||'/'||winner.candidate_id::text));
  end if;
  if operation.state not in ('reserved','uploaded') or operation.lease_expires_at<=v_now
     or not public.capture_account_write_allowed(p_owner_id)
     or not exists(select 1 from public.capture_cloud_subscriptions subscription
       where subscription.user_id=p_owner_id and subscription.is_entitled
         and subscription.access_expires_at>v_now) then
    raise insufficient_privilege using message='image finalization unavailable';
  end if;
  perform pg_catalog.set_config('capture.image_operation_id',operation.operation_id::text,true);
  insert into public.capture_image_publications(
    user_id,image_id,candidate_id,sha256,content_type,byte_size
  ) values(
    operation.owner_id,operation.image_id,operation.candidate_id,
    operation.sha256,operation.content_type,operation.byte_size
  ) on conflict (user_id,image_id) do nothing;
  select * into winner from public.capture_image_publications
    where user_id=p_owner_id and image_id=operation.image_id;
  if not found then raise exception 'image publication not visible'; end if;
  update public.capture_image_operations set
    state=case when candidate_id=winner.candidate_id then 'published' else 'abandoned' end,
    finalized_at=v_now,operation_version=operation_version+1,
    reconciliation_lease_id=null,reconciliation_lease_expires_at=null,updated_at=v_now
    where operation_id=operation.operation_id and state in ('reserved','uploaded')
    returning * into operation;
  delete from public.capture_external_work_admissions
    where admission_id=operation.operation_id and owner_id=p_owner_id and kind='image_upload';
  return jsonb_build_object('status',operation.state,'winner',
    jsonb_build_object('candidateId',winner.candidate_id,'sha256',winner.sha256,
      'contentType',winner.content_type,'byteSize',winner.byte_size,
      'bucket',operation.bucket_id,'objectPath',p_owner_id::text||'/'||winner.candidate_id::text));
end;
$$;

-- Expired leases are claimable for bounded reconciliation, but the default
-- policy refuses quota release because a quiet listing/HEAD cannot prove that a
-- provider completion will not land later.
create function public.claim_capture_image_reconciliation(p_reconciliation_lease_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  operation public.capture_image_operations%rowtype;
  v_claimed_state text;
  v_claimed_version bigint;
  v_now timestamptz:=clock_timestamp();
begin
  if p_reconciliation_lease_id is null then raise exception 'invalid reconciliation lease'; end if;
  select * into operation from public.capture_image_operations
    where state in ('reserved','uploaded','abandoned') and lease_expires_at<=v_now
      and (reconciliation_lease_expires_at is null or reconciliation_lease_expires_at<=v_now)
    order by created_at,operation_id limit 1;
  if not found then return null; end if;
  v_claimed_state:=operation.state;
  v_claimed_version:=operation.operation_version;
  perform public.capture_account_owner_lock(operation.owner_id);
  update public.capture_image_operations set
    reconciliation_lease_id=p_reconciliation_lease_id,
    reconciliation_lease_expires_at=v_now+interval '60 seconds',
    operation_version=operation_version+1,updated_at=v_now
    where operation_id=operation.operation_id and owner_id=operation.owner_id
      and state=v_claimed_state and operation_version=v_claimed_version
      and state in ('reserved','uploaded','abandoned') and lease_expires_at<=v_now
      and (reconciliation_lease_expires_at is null or reconciliation_lease_expires_at<=v_now)
    returning * into operation;
  if not found then return null; end if;
  return jsonb_build_object('operationId',operation.operation_id,'ownerId',operation.owner_id,
    'bucket',operation.bucket_id,'objectPath',operation.object_path,
    'claimedState',v_claimed_state,'operationVersion',operation.operation_version,
    'sha256',operation.sha256,'contentType',operation.content_type,'byteSize',operation.byte_size);
end;
$$;

create function public.reconcile_capture_image_operation(
  p_operation_id uuid,p_reconciliation_lease_id uuid,p_operation_version bigint,
  p_claimed_state text,p_object_absent boolean
) returns boolean language plpgsql security definer set search_path = '' as $$
declare operation public.capture_image_operations%rowtype; policy public.capture_image_storage_policy%rowtype;
begin
  select * into operation from public.capture_image_operations where operation_id=p_operation_id;
  if not found then return false; end if;
  perform public.capture_account_owner_lock(operation.owner_id);
  select * into policy from public.capture_image_storage_policy where singleton for share;
  if not found or not policy.stale_reclaim_enabled then
    raise exception 'provider inventory and quiescence are not attested';
  end if;
  select * into operation from public.capture_image_operations where operation_id=p_operation_id for update;
  if not found or operation.reconciliation_lease_id is distinct from p_reconciliation_lease_id
     or operation.reconciliation_lease_expires_at<=clock_timestamp()
     or operation.operation_version<>p_operation_version
     or operation.state is distinct from p_claimed_state
     or p_claimed_state not in ('reserved','uploaded','abandoned') then return false; end if;
  if p_object_absent then
    update public.capture_image_operations set state='released',finalized_at=coalesce(finalized_at,clock_timestamp()),
      operation_version=operation_version+1,reconciliation_lease_id=null,
      reconciliation_lease_expires_at=null,updated_at=clock_timestamp()
      where operation_id=p_operation_id and operation_version=p_operation_version
        and state=p_claimed_state and reconciliation_lease_id=p_reconciliation_lease_id;
    if not found then return false; end if;
    update public.capture_image_owner_usage as usage set
      reserved_objects=usage.reserved_objects-1,
      reserved_bytes=usage.reserved_bytes-operation.byte_size,updated_at=clock_timestamp()
      where owner_id=operation.owner_id and usage.reserved_objects>=1
        and usage.reserved_bytes>=operation.byte_size;
    if not found then raise exception 'image usage underflow'; end if;
  else
    update public.capture_image_operations set state='abandoned',finalized_at=coalesce(finalized_at,clock_timestamp()),
      operation_version=operation_version+1,reconciliation_lease_id=null,
      reconciliation_lease_expires_at=null,updated_at=clock_timestamp()
      where operation_id=p_operation_id and operation_version=p_operation_version
        and state=p_claimed_state and reconciliation_lease_id=p_reconciliation_lease_id;
    if not found then return false; end if;
  end if;
  delete from public.capture_external_work_admissions
    where admission_id=operation.operation_id and owner_id=operation.owner_id and kind='image_upload';
  return true;
end;
$$;

create function public.capture_image_operation_inventory(p_owner_id uuid,p_limit integer)
returns table(operation_id uuid,bucket_id text,object_path text,state text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_owner_id is null or p_limit<1 or p_limit>100 then raise exception 'invalid image inventory request'; end if;
  return query select operation.operation_id,operation.bucket_id,operation.object_path,operation.state
    from public.capture_image_operations operation
    where operation.owner_id=p_owner_id and operation.state not in ('released','deleted')
    order by operation.created_at,operation.operation_id limit p_limit;
end;
$$;

create function public.mark_capture_image_operation_deleted(
  p_owner_id uuid,p_operation_id uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
declare operation public.capture_image_operations%rowtype;
begin
  perform public.capture_account_owner_lock(p_owner_id);
  select * into operation from public.capture_image_operations
    where operation_id=p_operation_id and owner_id=p_owner_id for update;
  if not found then return true; end if;
  if operation.state in ('released','deleted') then
    update public.capture_image_operations set
      operation_version=operation_version+1,
      reconciliation_lease_id=null,reconciliation_lease_expires_at=null,
      updated_at=clock_timestamp()
      where operation_id=p_operation_id and reconciliation_lease_id is not null;
    return true;
  end if;
  update public.capture_image_operations set state='deleted',finalized_at=coalesce(finalized_at,clock_timestamp()),
    operation_version=operation_version+1,
    reconciliation_lease_id=null,reconciliation_lease_expires_at=null,
    updated_at=clock_timestamp() where operation_id=p_operation_id
      and state not in ('released','deleted');
  update public.capture_image_owner_usage as usage set
    reserved_objects=usage.reserved_objects-1,
    reserved_bytes=usage.reserved_bytes-operation.byte_size,updated_at=clock_timestamp()
    where owner_id=p_owner_id and usage.reserved_objects>=1
      and usage.reserved_bytes>=operation.byte_size;
  if not found then raise exception 'image usage underflow'; end if;
  delete from public.capture_external_work_admissions
    where admission_id=operation.operation_id and owner_id=p_owner_id and kind='image_upload';
  return true;
end;
$$;

create function public.capture_image_inventory_remaining(p_owner_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.capture_image_operations
    where owner_id=p_owner_id and state not in ('released','deleted'));
$$;

-- Browser-authenticated clients retain exact-owner reads but can no longer
-- admit Storage candidates or publication rows. Service Storage uploads bypass
-- RLS only after the reservation RPC returns a generated path.
revoke insert on public.capture_image_publications from authenticated;
drop policy if exists capture_candidates_insert on storage.objects;
drop policy if exists capture_fresh_insert on storage.objects;
drop policy if exists capture_image_app_only_insert on storage.objects;
create policy capture_image_app_only_insert on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id not in ('capture-images','capture-image-candidates','capture-image-candidates-fresh-20260914'));

-- Bind readiness to the exact policy/trigger definitions that close direct
-- Storage and publication admission, plus the private singleton-policy ACL.
-- A name-only check is unsafe: a permissive role/expression or altered trigger
-- body would otherwise keep the route open.
create function public.capture_image_admission_contract_fingerprint() returns text
language sql stable security definer set search_path = pg_catalog as $$
  select md5(
    coalesce((select pg_catalog.concat_ws('|',
      policy.polcmd::text,policy.polpermissive::text,
      (select pg_catalog.array_agg(role.rolname order by role.rolname)::text
        from pg_catalog.unnest(policy.polroles) role_oid
        join pg_catalog.pg_roles role on role.oid=role_oid),
      coalesce(pg_catalog.pg_get_expr(policy.polqual,policy.polrelid),'<null>'),
      coalesce(pg_catalog.pg_get_expr(policy.polwithcheck,policy.polrelid),'<null>'))
      from pg_catalog.pg_policy policy
      where policy.polrelid='storage.objects'::pg_catalog.regclass
        and policy.polname='capture_image_app_only_insert'),'<missing-policy>')
    || '||' ||
    coalesce((select pg_catalog.concat_ws('|',trigger.tgenabled::text,trigger.tgtype::text,
      pg_catalog.pg_get_triggerdef(trigger.oid,true),
      pg_catalog.pg_get_functiondef(trigger.tgfoid))
      from pg_catalog.pg_trigger trigger
      where trigger.tgrelid='public.capture_image_publications'::pg_catalog.regclass
        and trigger.tgname='capture_image_publication_admission_guard'
        and not trigger.tgisinternal),'<missing-trigger>')
    || '||' ||
    (select pg_catalog.concat_ws('|',class.relrowsecurity::text,
      pg_catalog.has_table_privilege('service_role','public.capture_image_storage_policy','SELECT')::text,
      pg_catalog.has_table_privilege('service_role','public.capture_image_storage_policy','UPDATE')::text,
      pg_catalog.has_table_privilege('service_role','public.capture_image_storage_policy','INSERT')::text,
      pg_catalog.has_table_privilege('service_role','public.capture_image_storage_policy','DELETE')::text,
      pg_catalog.has_table_privilege('service_role','public.capture_image_storage_policy','TRUNCATE')::text,
      pg_catalog.has_table_privilege('service_role','public.capture_image_storage_policy','REFERENCES')::text,
      pg_catalog.has_table_privilege('service_role','public.capture_image_storage_policy','TRIGGER')::text,
      (select pg_catalog.count(*)::text from pg_catalog.aclexplode(
        coalesce(class.relacl,pg_catalog.acldefault('r',class.relowner))) acl
        where acl.grantee in (0,
          (select oid from pg_catalog.pg_roles where rolname='anon'),
          (select oid from pg_catalog.pg_roles where rolname='authenticated'))))
      from pg_catalog.pg_class class
      where class.oid='public.capture_image_storage_policy'::pg_catalog.regclass)
  );
$$;
revoke all on function public.capture_image_admission_contract_fingerprint() from public,anon,authenticated;

-- Fresh activation's original fingerprint predates service-owned admission.
-- Extend it so policy/trigger drift closes both publication readiness and the
-- route's admission readiness after this additive migration is installed.
create or replace function public.capture_image_fresh_policy_fingerprint() returns text
language sql stable security definer set search_path = pg_catalog as $$
  select md5(coalesce((select string_agg(
    policy.polrelid::regclass::text || ':' || policy.polname || ':' || policy.polcmd::text
      || ':' || policy.polpermissive::text || ':' || policy.polroles::text
      || ':' || coalesce(pg_get_expr(policy.polqual,policy.polrelid),'')
      || ':' || coalesce(pg_get_expr(policy.polwithcheck,policy.polrelid),''),
    '|' order by policy.polrelid::regclass::text,policy.polname)
    from pg_policy policy
    where (policy.polrelid='storage.objects'::regclass
        and (policy.polname like 'capture_fresh_%'
          or policy.polname='capture_image_app_only_insert'))
      or policy.polrelid='public.capture_image_publications'::regclass),'')
    || '|admission:' || public.capture_image_admission_contract_fingerprint());
$$;
revoke all on function public.capture_image_fresh_policy_fingerprint() from public,anon,authenticated;

update public.capture_image_storage_policy set
  admission_fingerprint=public.capture_image_admission_contract_fingerprint(),
  updated_at=clock_timestamp()
  where singleton;

do $$ begin
  if to_regclass('public.capture_image_fresh_activation') is not null then
    update public.capture_image_fresh_activation
      set policy_fingerprint=public.capture_image_fresh_policy_fingerprint()
      where singleton;
    create trigger capture_image_fresh_fixed
      before insert or update or delete on public.capture_image_fresh_activation
      for each row execute function public.capture_image_fresh_fixed_fn();
    if not public.capture_image_publication_ready() then
      raise exception 'Image admission fresh activation failed';
    end if;
  end if;
end $$;

create function public.capture_image_admission_ready() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.capture_image_publication_ready()
    and to_regclass('public.capture_image_operations') is not null
    and to_regclass('public.capture_image_owner_usage') is not null
    and (select count(*)=1 from public.capture_image_storage_policy)
    and exists(select 1 from public.capture_image_storage_policy policy
      where policy.singleton and policy.max_objects=256 and policy.max_bytes=576000000
        and policy.max_object_bytes=2250000 and policy.lease_seconds=120
        and not policy.stale_reclaim_enabled
        and policy.admission_fingerprint=public.capture_image_admission_contract_fingerprint())
    and exists(select 1 from pg_catalog.pg_class class
      where class.oid='public.capture_image_storage_policy'::regclass and class.relrowsecurity)
    and has_table_privilege('service_role','public.capture_image_storage_policy','SELECT')
    and has_table_privilege('service_role','public.capture_image_storage_policy','UPDATE')
    and not has_table_privilege('service_role','public.capture_image_storage_policy','INSERT')
    and not has_table_privilege('service_role','public.capture_image_storage_policy','DELETE')
    and not has_table_privilege('service_role','public.capture_image_storage_policy','TRUNCATE')
    and not has_table_privilege('service_role','public.capture_image_storage_policy','REFERENCES')
    and not has_table_privilege('service_role','public.capture_image_storage_policy','TRIGGER')
    and not exists(select 1 from pg_catalog.pg_class class,
      lateral pg_catalog.aclexplode(coalesce(class.relacl,pg_catalog.acldefault('r',class.relowner))) acl
      where class.oid='public.capture_image_storage_policy'::regclass
        and acl.grantee in (0,
          (select oid from pg_catalog.pg_roles where rolname='anon'),
          (select oid from pg_catalog.pg_roles where rolname='authenticated')))
    and not has_table_privilege('authenticated','public.capture_image_operations','SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated','public.capture_image_owner_usage','SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated','public.capture_image_storage_policy','SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated','public.capture_image_publications','INSERT')
    and exists(select 1 from pg_catalog.pg_policy policy
      where policy.polrelid='storage.objects'::regclass
        and policy.polname='capture_image_app_only_insert'
        and not policy.polpermissive and policy.polcmd='a'
        and policy.polroles=array[(select oid from pg_catalog.pg_roles where rolname='authenticated')]::oid[]
        and policy.polqual is null
        and pg_catalog.pg_get_expr(policy.polwithcheck,policy.polrelid)=
          '(bucket_id <> ALL (ARRAY[''capture-images''::text, ''capture-image-candidates''::text, ''capture-image-candidates-fresh-20260914''::text]))')
    and exists(select 1 from pg_catalog.pg_trigger trigger
      join pg_catalog.pg_proc procedure on procedure.oid=trigger.tgfoid
      where trigger.tgrelid='public.capture_image_publications'::regclass
        and trigger.tgname='capture_image_publication_admission_guard'
        and not trigger.tgisinternal and trigger.tgenabled='O' and trigger.tgtype=7
        and trigger.tgfoid='public.capture_image_publication_admission_guard_fn()'::regprocedure
        and trigger.tgqual is null and procedure.prosecdef
        and procedure.prorettype='pg_catalog.trigger'::regtype
        and procedure.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')
        and procedure.proconfig=array['search_path=""']::text[]
        and procedure.prosrc=$capture_guard$
declare v_operation_id uuid;
begin
  begin
    v_operation_id := nullif(current_setting('capture.image_operation_id',true),'')::uuid;
  exception when others then
    raise insufficient_privilege using message='image operation required';
  end;
  if v_operation_id is null or not exists(
    select 1 from public.capture_image_operations operation
    where operation.operation_id=v_operation_id and operation.owner_id=new.user_id
      and operation.image_id=new.image_id and operation.candidate_id=new.candidate_id
      and operation.sha256=new.sha256 and operation.content_type=new.content_type
      and operation.byte_size=new.byte_size and operation.state in ('reserved','uploaded')
  ) then raise insufficient_privilege using message='image operation mismatch'; end if;
  return new;
end;
$capture_guard$);
$$;
revoke all on function public.capture_image_admission_ready() from public,anon,authenticated;
grant execute on function public.capture_image_admission_ready() to authenticated,service_role;

revoke all on function public.reserve_capture_image_storage(uuid,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.record_capture_image_storage_upload(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.release_capture_image_storage_reservation(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.abandon_capture_image_storage_reservation(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.finalize_capture_image_storage(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.claim_capture_image_reconciliation(uuid) from public,anon,authenticated;
revoke all on function public.reconcile_capture_image_operation(uuid,uuid,bigint,text,boolean) from public,anon,authenticated;
revoke all on function public.capture_image_operation_inventory(uuid,integer) from public,anon,authenticated;
revoke all on function public.mark_capture_image_operation_deleted(uuid,uuid) from public,anon,authenticated;
revoke all on function public.capture_image_inventory_remaining(uuid) from public,anon,authenticated;
revoke all on function public.capture_image_admission_contract_fingerprint() from public,anon,authenticated;
grant execute on function public.reserve_capture_image_storage(uuid,text,text,text,integer) to service_role;
grant execute on function public.record_capture_image_storage_upload(uuid,uuid,uuid) to service_role;
grant execute on function public.release_capture_image_storage_reservation(uuid,uuid,uuid) to service_role;
grant execute on function public.abandon_capture_image_storage_reservation(uuid,uuid,uuid) to service_role;
grant execute on function public.finalize_capture_image_storage(uuid,uuid,uuid) to service_role;
grant execute on function public.claim_capture_image_reconciliation(uuid) to service_role;
grant execute on function public.reconcile_capture_image_operation(uuid,uuid,bigint,text,boolean) to service_role;
grant execute on function public.capture_image_operation_inventory(uuid,integer) to service_role;
grant execute on function public.mark_capture_image_operation_deleted(uuid,uuid) to service_role;
grant execute on function public.capture_image_inventory_remaining(uuid) to service_role;
grant execute on function public.capture_image_admission_contract_fingerprint() to service_role;

-- Extend the existing app-row stage so image accounting cannot survive owner
-- deletion. Storage objects and ledger rows are drained/read back first.
create or replace function public.delete_capture_account_app_rows(p_owner_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.capture_account_deleting(p_owner_id) then
    raise insufficient_privilege using message='erasure fence required';
  end if;
  delete from public.capture_image_operations where owner_id=p_owner_id;
  delete from public.capture_image_owner_usage where owner_id=p_owner_id;
  delete from public.capture_cloud_owner_quotas where user_id=p_owner_id;
  delete from public.capture_boards where user_id=p_owner_id;
  delete from public.capture_image_publications where user_id=p_owner_id;
  delete from public.capture_cloud_subscriptions where user_id=p_owner_id;
  delete from public.capture_external_work_admissions where owner_id=p_owner_id;
  delete from public.capture_external_capabilities where owner_id=p_owner_id;
  return true;
end;
$$;
create or replace function public.capture_account_app_rows_exist(p_owner_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.capture_boards where user_id=p_owner_id)
    or exists(select 1 from public.capture_image_publications where user_id=p_owner_id)
    or exists(select 1 from public.capture_image_operations where owner_id=p_owner_id)
    or exists(select 1 from public.capture_image_owner_usage where owner_id=p_owner_id)
    or exists(select 1 from public.capture_cloud_owner_quotas where user_id=p_owner_id)
    or exists(select 1 from public.capture_cloud_subscriptions where user_id=p_owner_id)
    or exists(select 1 from public.capture_external_work_admissions where owner_id=p_owner_id)
    or exists(select 1 from public.capture_external_capabilities where owner_id=p_owner_id);
$$;
revoke all on function public.delete_capture_account_app_rows(uuid) from public,anon,authenticated;
revoke all on function public.capture_account_app_rows_exist(uuid) from public,anon,authenticated;
grant execute on function public.delete_capture_account_app_rows(uuid) to service_role;
grant execute on function public.capture_account_app_rows_exist(uuid) to service_role;

do $$ begin
  if not public.capture_image_admission_ready() then
    raise exception 'Image admission readiness failed';
  end if;
end $$;
commit;
