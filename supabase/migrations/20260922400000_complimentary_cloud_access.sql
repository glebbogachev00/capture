-- Service-managed complimentary Capture Cloud access.
-- Grants are keyed only by Auth UUID; email is never stored in this schema.
begin;
set local lock_timeout = '10s';

create table if not exists public.capture_cloud_complimentary_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check (expires_at is null or expires_at > granted_at),
  check (revoked_at is null or revoked_at >= granted_at)
);
create index if not exists capture_cloud_complimentary_current_idx
  on public.capture_cloud_complimentary_grants(user_id, expires_at)
  where revoked_at is null;
alter table public.capture_cloud_complimentary_grants enable row level security;
revoke all on table public.capture_cloud_complimentary_grants from public, anon, authenticated;
grant select, insert, update, delete on table public.capture_cloud_complimentary_grants to service_role;

create or replace function public.capture_cloud_access_current(p_user_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('role', true), 'none')
  );
begin
  if p_user_id is null then return false; end if;
  if (v_caller is not null and v_caller is distinct from p_user_id)
     or (v_caller is null and v_role = 'authenticated') then
    raise insufficient_privilege using message = 'exact owner required';
  end if;
  return exists(
    select 1 from public.capture_cloud_subscriptions subscription
    where subscription.user_id=p_user_id and subscription.is_entitled
      and subscription.access_expires_at > statement_timestamp()
  ) or exists(
    select 1 from public.capture_cloud_complimentary_grants grant_row
    where grant_row.user_id=p_user_id and grant_row.revoked_at is null
      and (grant_row.expires_at is null or grant_row.expires_at > statement_timestamp())
  );
end;
$$;
revoke all on function public.capture_cloud_access_current(uuid) from public, anon;
grant execute on function public.capture_cloud_access_current(uuid) to authenticated, service_role;

create or replace function public.capture_cloud_complimentary_grant_status(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('role', true), 'none')
  );
  v_expires_at timestamptz;
  v_current boolean := false;
begin
  if p_user_id is null then return jsonb_build_object('current',false,'expiresAt',null); end if;
  if (v_caller is not null and v_caller is distinct from p_user_id)
     or (v_caller is null and v_role = 'authenticated') then
    raise insufficient_privilege using message = 'exact owner required';
  end if;
  select true,expires_at into v_current,v_expires_at
    from public.capture_cloud_complimentary_grants
    where user_id=p_user_id and revoked_at is null
      and (expires_at is null or expires_at > statement_timestamp());
  return jsonb_build_object('current',v_current,'expiresAt',v_expires_at);
end;
$$;
revoke all on function public.capture_cloud_complimentary_grant_status(uuid) from public, anon;
grant execute on function public.capture_cloud_complimentary_grant_status(uuid) to authenticated, service_role;

create or replace function public.grant_capture_cloud_complimentary_access(
  p_user_id uuid,
  p_expires_at timestamptz default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp();
begin
  if p_user_id is null or (p_expires_at is not null and p_expires_at <= v_now) then
    raise exception 'invalid complimentary grant';
  end if;
  perform public.capture_account_owner_lock(p_user_id);
  perform 1 from auth.users where id=p_user_id for key share;
  if not found or not public.capture_account_write_allowed(p_user_id) then
    raise insufficient_privilege using message='owner unavailable';
  end if;
  insert into public.capture_cloud_complimentary_grants as grant_row(
    user_id,granted_at,expires_at,revoked_at,updated_at
  ) values(p_user_id,v_now,p_expires_at,null,v_now)
  on conflict(user_id) do update set
    granted_at=v_now,expires_at=excluded.expires_at,revoked_at=null,updated_at=v_now;
  return true;
end;
$$;
create or replace function public.revoke_capture_cloud_complimentary_access(
  p_user_id uuid,
  p_revoked_at timestamptz default clock_timestamp()
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_revoked_at is null then raise exception 'invalid complimentary revocation'; end if;
  perform public.capture_account_owner_lock(p_user_id);
  update public.capture_cloud_complimentary_grants
    set revoked_at=p_revoked_at,updated_at=clock_timestamp()
    where user_id=p_user_id and revoked_at is null;
  return found;
end;
$$;
revoke all on function public.grant_capture_cloud_complimentary_access(uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.revoke_capture_cloud_complimentary_access(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.grant_capture_cloud_complimentary_access(uuid,timestamptz) to service_role;
grant execute on function public.revoke_capture_cloud_complimentary_access(uuid,timestamptz) to service_role;

-- Recovery reads remain owner-authenticated after access lapses, but direct
-- browser writes must pass the same paid-or-complimentary predicate as the
-- application route. Restrictive policies compose with the existing owner and
-- account-erasure policies without weakening either boundary.
drop policy if exists capture_boards_cloud_access_insert on public.capture_boards;
create policy capture_boards_cloud_access_insert on public.capture_boards
  as restrictive for insert to authenticated
  with check (public.capture_cloud_access_current((select auth.uid())));
drop policy if exists capture_boards_cloud_access_update on public.capture_boards;
create policy capture_boards_cloud_access_update on public.capture_boards
  as restrictive for update to authenticated
  using (public.capture_cloud_access_current((select auth.uid())))
  with check (public.capture_cloud_access_current((select auth.uid())));
drop policy if exists capture_boards_cloud_access_delete on public.capture_boards;
create policy capture_boards_cloud_access_delete on public.capture_boards
  as restrictive for delete to authenticated
  using (public.capture_cloud_access_current((select auth.uid())));

-- Re-attest fresh image policy activation while replacing every final write gate.
do $$ begin
  if to_regclass('public.capture_image_fresh_activation') is not null then
    lock table public.capture_image_fresh_activation in access exclusive mode;
    drop trigger if exists capture_image_fresh_fixed on public.capture_image_fresh_activation;
  end if;
end $$;

drop policy if exists capture_image_publication_owner_insert on public.capture_image_publications;
create policy capture_image_publication_owner_insert on public.capture_image_publications
  for insert to authenticated
  with check (user_id=(select auth.uid()) and public.capture_image_publication_ready()
    and public.capture_cloud_access_current((select auth.uid())));

drop policy if exists capture_images_write_entitlement on storage.objects;
create policy capture_images_write_entitlement on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'capture-images'
    or public.capture_cloud_access_current((select auth.uid())));
drop policy if exists capture_candidates_write_entitlement on storage.objects;
create policy capture_candidates_write_entitlement on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'capture-image-candidates'
    or public.capture_cloud_access_current((select auth.uid())));
drop policy if exists capture_fresh_write_entitlement on storage.objects;
create policy capture_fresh_write_entitlement on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'capture-image-candidates-fresh-20260914'
    or public.capture_cloud_access_current((select auth.uid())));

create or replace function public.reserve_capture_image_storage(
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
  if not public.capture_cloud_access_current(p_owner_id) then
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

create or replace function public.finalize_capture_image_storage(
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
     or not public.capture_cloud_access_current(p_owner_id) then
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

create or replace function public.capture_complimentary_grant_erasure_fence_fn()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.stage='prepared' and new.stage<>'prepared' and new.owner_id is not null then
    update public.capture_cloud_complimentary_grants
      set revoked_at=coalesce(revoked_at,new.confirmed_at,clock_timestamp()),
          updated_at=clock_timestamp()
      where user_id=new.owner_id and revoked_at is null;
  end if;
  return new;
end;
$$;
revoke all on function public.capture_complimentary_grant_erasure_fence_fn() from public, anon, authenticated;
drop trigger if exists capture_complimentary_grant_erasure_fence on public.capture_account_erasure_operations;
create trigger capture_complimentary_grant_erasure_fence
  after update of stage on public.capture_account_erasure_operations
  for each row execute function public.capture_complimentary_grant_erasure_fence_fn();

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
  delete from public.capture_cloud_complimentary_grants where user_id=p_owner_id;
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
  return exists(select 1 from public.capture_cloud_complimentary_grants where user_id=p_owner_id)
    or exists(select 1 from public.capture_boards where user_id=p_owner_id)
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

do $$ begin
  if to_regclass('public.capture_image_fresh_activation') is not null then
    update public.capture_image_fresh_activation
      set policy_fingerprint=public.capture_image_fresh_policy_fingerprint()
      where singleton;
    create trigger capture_image_fresh_fixed
      before insert or update or delete on public.capture_image_fresh_activation
      for each row execute function public.capture_image_fresh_fixed_fn();
    if not public.capture_image_publication_ready() then
      raise exception 'Complimentary-access image activation failed';
    end if;
  end if;
end $$;

commit;
