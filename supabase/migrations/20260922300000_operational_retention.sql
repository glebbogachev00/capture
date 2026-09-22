-- Capture Cloud operational retention and aggregate readiness.
-- Additive, service-only, source-disabled until the protected cron contract is configured.
begin;
set local lock_timeout = '10s';

create table if not exists public.capture_operational_maintenance (
  singleton boolean primary key default true check (singleton),
  lease_id uuid,
  lease_expires_at timestamptz,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_outcome text check (last_outcome in ('completed','contended')),
  updated_at timestamptz not null default clock_timestamp(),
  check ((lease_id is null) = (lease_expires_at is null))
);
insert into public.capture_operational_maintenance(singleton) values(true)
  on conflict(singleton) do nothing;
alter table public.capture_operational_maintenance enable row level security;
revoke all on table public.capture_operational_maintenance from public,anon,authenticated;
grant select,update on table public.capture_operational_maintenance to service_role;

-- Completed receipt rows are intentionally short-lived. Preserve immutable,
-- content-free proof before they expire; legal retention for this evidence is
-- a hosted policy decision, so source cleanup never deletes it.
create table if not exists public.capture_account_erasure_evidence (
  operation_id uuid primary key,
  confirmed_at timestamptz not null,
  completed_at timestamptz not null,
  attempt_count integer not null check (attempt_count >= 0),
  retry_count integer not null check (retry_count >= 0),
  recorded_at timestamptz not null default clock_timestamp()
);
alter table public.capture_account_erasure_evidence enable row level security;
revoke all on table public.capture_account_erasure_evidence from public,anon,authenticated;
grant select on table public.capture_account_erasure_evidence to service_role;

create or replace function public.capture_account_erasure_evidence_guard_fn()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise insufficient_privilege using message='account erasure evidence is immutable';
end;
$$;
revoke all on function public.capture_account_erasure_evidence_guard_fn() from public,anon,authenticated;
drop trigger if exists capture_account_erasure_evidence_guard on public.capture_account_erasure_evidence;
create trigger capture_account_erasure_evidence_guard
  before update or delete on public.capture_account_erasure_evidence
  for each row execute function public.capture_account_erasure_evidence_guard_fn();

create or replace function public.capture_account_erasure_evidence_fn()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.stage='complete' and new.completed_at is not null and new.confirmed_at is not null then
    insert into public.capture_account_erasure_evidence(
      operation_id,confirmed_at,completed_at,attempt_count,retry_count
    ) values(
      new.operation_id,new.confirmed_at,new.completed_at,new.attempt_count,new.retry_count
    ) on conflict(operation_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.capture_account_erasure_evidence_fn() from public,anon,authenticated;
drop trigger if exists capture_account_erasure_evidence on public.capture_account_erasure_operations;
create trigger capture_account_erasure_evidence
  after insert or update of stage,completed_at on public.capture_account_erasure_operations
  for each row execute function public.capture_account_erasure_evidence_fn();
insert into public.capture_account_erasure_evidence(
  operation_id,confirmed_at,completed_at,attempt_count,retry_count
)
select operation_id,confirmed_at,completed_at,attempt_count,retry_count
from public.capture_account_erasure_operations
where stage='complete' and confirmed_at is not null and completed_at is not null
on conflict(operation_id) do nothing;

-- Replace the earlier receipt sweeper so complete rows cannot disappear before
-- immutable evidence exists. Prepared rows have no accepted obligation.
create or replace function public.cleanup_capture_account_erasure_receipts()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  with expired as (
    select operation.operation_id
    from public.capture_account_erasure_operations operation
    where operation.stage in ('prepared','complete')
      and operation.receipt_expires_at <= clock_timestamp()
      and (operation.stage='prepared' or exists(
        select 1 from public.capture_account_erasure_evidence evidence
        where evidence.operation_id=operation.operation_id
      ))
    order by operation.receipt_expires_at,operation.operation_id
    for update skip locked limit 100
  )
  delete from public.capture_account_erasure_operations operation
  using expired
  where operation.operation_id=expired.operation_id
    and operation.stage in ('prepared','complete')
    and operation.receipt_expires_at <= clock_timestamp()
    and (operation.stage='prepared' or exists(
      select 1 from public.capture_account_erasure_evidence evidence
      where evidence.operation_id=operation.operation_id
    ));
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;
revoke all on function public.cleanup_capture_account_erasure_receipts() from public,anon,authenticated;
grant execute on function public.cleanup_capture_account_erasure_receipts() to service_role;

create or replace function public.capture_run_retention_cleanup(p_now timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_total integer:=0;
  v_count integer:=0;
  v_cutoff_ms numeric:=extract(epoch from (p_now-interval '30 days'))*1000;
  row_record record;
begin
  -- Idle boards never merge, so age their 30-day tombstones here. Locking and
  -- rev increments make concurrent optimistic board writes retry safely.
  with candidates as (
    select board.user_id,board.tombstones
    from public.capture_boards board
    where exists(
      select 1 from pg_catalog.jsonb_array_elements(board.tombstones) item
      where pg_catalog.jsonb_typeof(item)='object'
        and pg_catalog.jsonb_typeof(item->'deletedAt')='number'
        and (item->>'deletedAt')::numeric < v_cutoff_ms
    )
    order by board.updated_at,board.user_id
    for update skip locked limit 100
  )
  update public.capture_boards board set
    tombstones=(
      select coalesce(pg_catalog.jsonb_agg(item),'[]'::jsonb)
      from pg_catalog.jsonb_array_elements(candidates.tombstones) item
      where not (
        pg_catalog.jsonb_typeof(item)='object'
        and pg_catalog.jsonb_typeof(item->'deletedAt')='number'
        and (item->>'deletedAt')::numeric < v_cutoff_ms
      )
    ),
    rev=board.rev+1,
    updated_at=p_now
  from candidates where board.user_id=candidates.user_id;
  get diagnostics v_count=row_count; v_total:=v_total+v_count;

  -- Expired fixed windows have no enforcement value after a seven-day buffer.
  with candidates as (
    select quota.user_id,quota.scope
    from public.capture_cloud_owner_quotas quota
    join public.capture_cloud_quota_policies policy on policy.scope=quota.scope
    where quota.window_started_at
      + pg_catalog.make_interval(secs=>policy.window_seconds)
      <= p_now-interval '7 days'
    order by quota.updated_at,quota.user_id,quota.scope
    for update of quota skip locked limit 100
  )
  delete from public.capture_cloud_owner_quotas quota using candidates
  where quota.user_id=candidates.user_id and quota.scope=candidates.scope
    and exists(
      select 1 from public.capture_cloud_quota_policies policy
      where policy.scope=quota.scope
        and quota.window_started_at+pg_catalog.make_interval(secs=>policy.window_seconds)
          <= p_now-interval '7 days'
    );
  get diagnostics v_count=row_count; v_total:=v_total+v_count;

  -- Only non-latest delivery receipts for long-terminal subscription sources
  -- are eligible. Subscription, invoice, order and other fiscal records are
  -- not stored here and are never deletion targets of this migration.
  with candidates as (
    select event.event_id
    from public.polar_webhook_events event
    join public.capture_cloud_subscriptions subscription
      on subscription.polar_subscription_id=event.polar_subscription_id
    where event.processed_at <= p_now-interval '400 days'
      and subscription.updated_at <= p_now-interval '400 days'
      and subscription.status in ('canceled','revoked','inactive')
      and not subscription.is_entitled
      and not subscription.reconciliation_required
      -- Preserve every receipt at the authoritative provider-event watermark,
      -- not just one arbitrary member of an equal-timestamp tie.
      and event.event_created_at is distinct from subscription.last_event_at
      and exists(
        select 1 from public.polar_webhook_events newer
        where newer.polar_subscription_id=event.polar_subscription_id
          and (newer.processed_at,newer.event_id)>(event.processed_at,event.event_id)
      )
    order by event.processed_at,event.event_id
    for update of event skip locked limit 100
  )
  delete from public.polar_webhook_events event using candidates
  where event.event_id=candidates.event_id
    and event.processed_at <= p_now-interval '400 days'
    and exists(
      select 1 from public.capture_cloud_subscriptions subscription
      where subscription.polar_subscription_id=event.polar_subscription_id
        and subscription.updated_at <= p_now-interval '400 days'
        and subscription.status in ('canceled','revoked','inactive')
        and not subscription.is_entitled
        and not subscription.reconciliation_required
        and event.event_created_at is distinct from subscription.last_event_at
    )
    and exists(
      select 1 from public.polar_webhook_events newer
      where newer.polar_subscription_id=event.polar_subscription_id
        and (newer.processed_at,newer.event_id)>(event.processed_at,event.event_id)
    );
  get diagnostics v_count=row_count; v_total:=v_total+v_count;

  -- Owner locks serialize admission/capability expiry with confirmation and new
  -- provider work. The repeated predicate makes replay idempotent.
  for row_record in
    with ranked as (
      select admission_id,owner_id,lease_expires_at,
        pg_catalog.row_number() over(
          partition by owner_id order by lease_expires_at,admission_id
        ) as owner_rank
      from public.capture_external_work_admissions
      where lease_expires_at <= p_now-interval '7 days'
    ), selected as (
      -- Interleave owners before applying the batch bound. One contended owner
      -- with more than a full batch cannot hide an unrelated eligible owner.
      select admission_id from ranked
      order by owner_rank,lease_expires_at,admission_id limit 100
    )
    select admission.admission_id,admission.owner_id
    from public.capture_external_work_admissions admission
    join selected using(admission_id)
    order by admission.lease_expires_at,admission.admission_id
    for update of admission skip locked
  loop
    -- Never wait for an owner lock while holding the candidate row plus the
    -- maintenance singleton/global locks. The row remains for a later replay.
    if not pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended(row_record.owner_id::text,912221)
    ) then continue; end if;
    delete from public.capture_external_work_admissions
    where admission_id=row_record.admission_id and owner_id=row_record.owner_id
      and lease_expires_at <= p_now-interval '7 days';
    get diagnostics v_count=row_count; v_total:=v_total+v_count;
  end loop;

  for row_record in
    with ranked as (
      select capability_id,owner_id,expires_at,
        pg_catalog.row_number() over(
          partition by owner_id order by expires_at,capability_id
        ) as owner_rank
      from public.capture_external_capabilities
      where expires_at <= p_now-interval '7 days'
    ), selected as (
      select capability_id from ranked
      order by owner_rank,expires_at,capability_id limit 100
    )
    select capability.capability_id,capability.owner_id
    from public.capture_external_capabilities capability
    join selected using(capability_id)
    order by capability.expires_at,capability.capability_id
    for update of capability skip locked
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended(row_record.owner_id::text,912221)
    ) then continue; end if;
    delete from public.capture_external_capabilities
    where capability_id=row_record.capability_id and owner_id=row_record.owner_id
      and expires_at <= p_now-interval '7 days';
    get diagnostics v_count=row_count; v_total:=v_total+v_count;
  end loop;

  -- Released/deleted operations are no longer physical inventory. Every other
  -- image state, every publication and every owner-usage row is preserved.
  with candidates as (
    select operation.operation_id
    from public.capture_image_operations operation
    where operation.state in ('released','deleted')
      and operation.finalized_at <= p_now-interval '90 days'
    order by operation.finalized_at,operation.operation_id
    for update skip locked limit 100
  )
  delete from public.capture_image_operations operation using candidates
  where operation.operation_id=candidates.operation_id
    and operation.state in ('released','deleted')
    and operation.finalized_at <= p_now-interval '90 days';
  get diagnostics v_count=row_count; v_total:=v_total+v_count;

  select public.cleanup_capture_account_erasure_receipts() into v_count;
  v_total:=v_total+v_count;
  return v_total;
end;
$$;
revoke all on function public.capture_run_retention_cleanup(timestamptz)
  from public,anon,authenticated,service_role;

create or replace function public.run_capture_operational_maintenance(
  p_lease_id uuid,p_now timestamptz,p_lease_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_changed integer; v_state_found boolean:=false;
begin
  if p_lease_id is null or p_now is null
     or pg_catalog.abs(extract(epoch from (p_now-clock_timestamp())))>30
     or p_lease_expires_at<=p_now
     or p_lease_expires_at>p_now+interval '60 seconds' then
    raise exception 'invalid operational maintenance lease';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('capture-operational-maintenance',9223)
  ) then
    return pg_catalog.jsonb_build_object('outcome','contended');
  end if;
  begin
    select true into v_state_found
    from public.capture_operational_maintenance where singleton for update nowait;
  exception when lock_not_available then
    return pg_catalog.jsonb_build_object('outcome','contended');
  end;
  if not v_state_found then raise exception 'operational maintenance state unavailable'; end if;
  if exists(
    select 1 from public.capture_operational_maintenance
    where singleton and lease_expires_at>p_now and lease_id is distinct from p_lease_id
  ) then
    update public.capture_operational_maintenance set
      last_outcome='contended',updated_at=p_now where singleton;
    return pg_catalog.jsonb_build_object('outcome','contended');
  end if;
  update public.capture_operational_maintenance set
    lease_id=p_lease_id,lease_expires_at=p_lease_expires_at,
    last_started_at=p_now,last_outcome=null,updated_at=p_now where singleton;
  v_changed:=public.capture_run_retention_cleanup(p_now);
  update public.capture_operational_maintenance set
    lease_id=null,lease_expires_at=null,last_completed_at=clock_timestamp(),
    last_outcome='completed',updated_at=clock_timestamp() where singleton;
  return pg_catalog.jsonb_build_object('outcome','completed','changedCount',v_changed);
end;
$$;
revoke all on function public.run_capture_operational_maintenance(uuid,timestamptz,timestamptz)
  from public,anon,authenticated;
grant execute on function public.run_capture_operational_maintenance(uuid,timestamptz,timestamptz)
  to service_role;

create or replace function public.capture_operational_health()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_overdue text;
  v_billing text;
  v_webhook text:='unknown';
  v_image text;
  v_quota text;
  v_readiness text;
  v_maintenance text;
  v_count bigint;
begin
  select case
    when exists(select 1 from public.capture_account_erasure_operations
      where stage not in ('prepared','complete')
        and (confirmed_at<=v_now-interval '24 hours' or retry_count>=10)) then 'critical'
    when exists(select 1 from public.capture_account_erasure_operations
      where stage not in ('prepared','complete')
        and (retry_after is null or retry_after<=v_now)
        and (lease_expires_at is null or lease_expires_at<=v_now)) then 'warning'
    else 'ok' end into v_overdue;

  select count(*),case
    when count(*)>=10 or min(reconcile_after)<=v_now-interval '1 hour' then 'critical'
    when count(*)>0 then 'warning' else 'ok' end
  into v_count,v_billing
  from public.capture_cloud_subscriptions
  where reconciliation_required;

  -- Database rows cannot prove provider endpoint enablement or expected traffic.
  -- Keep this unknown until the hosted Polar readback in the runbook is wired.
  v_webhook:='unknown';

  select case
    when count(*) filter(where operation.state in ('reserved','uploaded','abandoned')
      and operation.lease_expires_at<=v_now)>=100
      or exists(select 1 from public.capture_image_owner_usage usage
        cross join public.capture_image_storage_policy policy
        where policy.singleton and (usage.reserved_objects*100>=policy.max_objects*95
          or usage.reserved_bytes*100>=policy.max_bytes*95)) then 'critical'
    when count(*) filter(where operation.state in ('reserved','uploaded','abandoned')
      and operation.lease_expires_at<=v_now)>=10
      or exists(select 1 from public.capture_image_owner_usage usage
        cross join public.capture_image_storage_policy policy
        where policy.singleton and (usage.reserved_objects*100>=policy.max_objects*80
          or usage.reserved_bytes*100>=policy.max_bytes*80)) then 'warning'
    else 'ok' end into v_image
  from public.capture_image_operations operation;

  select case when count(distinct quota.user_id)>=10 then 'critical'
    when count(distinct quota.user_id)>0 then 'warning' else 'ok' end into v_quota
  from public.capture_cloud_owner_quotas quota
  join public.capture_cloud_quota_policies policy on policy.scope=quota.scope
  where quota.window_started_at+pg_catalog.make_interval(secs=>policy.window_seconds)>v_now
    and quota.request_count*100>=policy.request_limit*90;

  select case
    when to_regclass('public.capture_operational_maintenance') is null
      or to_regclass('public.capture_account_erasure_evidence') is null
      or to_regprocedure('public.cleanup_capture_account_erasure_receipts()') is null
      or to_regprocedure('public.capture_image_admission_ready()') is null then 'critical'
    when not public.capture_image_admission_ready() then 'critical'
    else 'ok' end into v_readiness;

  select case
    when last_completed_at is null or last_completed_at<=v_now-interval '24 hours' then 'critical'
    when last_completed_at<=v_now-interval '2 hours' then 'warning'
    else 'ok' end into v_maintenance
  from public.capture_operational_maintenance where singleton;
  v_maintenance:=coalesce(v_maintenance,'critical');

  return pg_catalog.jsonb_build_object(
    'overdueErasures',v_overdue,
    'billingReconciliation',v_billing,
    'webhookDelivery',v_webhook,
    'imagePressure',v_image,
    'quotaPressure',v_quota,
    'readinessDrift',v_readiness,
    'maintenance',v_maintenance
  );
end;
$$;
revoke all on function public.capture_operational_health() from public,anon,authenticated;
grant execute on function public.capture_operational_health() to service_role;

commit;
