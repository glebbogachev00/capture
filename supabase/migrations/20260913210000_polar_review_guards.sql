-- Additive review fixes: durable invalid-state denial and parent-first row locks.
-- Serialize IDs, then lock the immutable auth parent BEFORE subscription/ledger
-- rows. Deletion never takes our advisory lock and can cascade while RPCs wait.
create function public.lock_polar_parent(p_subscription_id text, p_new_user_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare owner_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_subscription_id, 714));
  select user_id into owner_id from public.capture_cloud_subscriptions where polar_subscription_id = p_subscription_id;
  perform 1 from auth.users where id = coalesce(owner_id, p_new_user_id) for key share;
  -- Remember the observed binding even if deletion wins while we wait.
  return coalesce(owner_id, p_new_user_id);
end;
$$;
revoke all on function public.lock_polar_parent(text, uuid) from public, anon, authenticated, service_role;

-- No supplied identity/product: only an existing binding can be queued.
create function public.queue_invalid_polar_event(p_subscription_id text, p_event_id text,
  p_event_type text, p_event_created_at timestamptz) returns boolean
language plpgsql security definer set search_path = '' as $$
declare s public.capture_cloud_subscriptions%rowtype;
begin
  perform public.lock_polar_parent(p_subscription_id);
  select * into s from public.capture_cloud_subscriptions where polar_subscription_id = p_subscription_id for update;
  if not found then return false; end if;
  insert into public.polar_webhook_events(event_id, event_type, user_id, polar_subscription_id, event_created_at)
    values(p_event_id, p_event_type, s.user_id, p_subscription_id, p_event_created_at)
    on conflict(event_id) do nothing;
  if found and p_event_created_at >= s.last_event_at then
    update public.capture_cloud_subscriptions set is_entitled = false,
      reconciliation_required = true, authoritative_mode = true,
      state_version = state_version + 1, reconcile_after = '-infinity',
      last_event_at = p_event_created_at, updated_at = now()
      where polar_subscription_id = p_subscription_id;
  end if;
  -- Duplicates retain the lease/version, but callers must retry pending work.
  return true;
end;
$$;
revoke all on function public.queue_invalid_polar_event(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.queue_invalid_polar_event(text, text, text, timestamptz) to service_role;

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
  locked_owner uuid;
begin
  -- Serialize first inserts as well as existing rows. A hash collision only
  -- reduces concurrency; it cannot merge subscription identities.
  locked_owner := public.lock_polar_parent(p_polar_subscription_id, p_user_id);
  select * into previous from public.capture_cloud_subscriptions
    where polar_subscription_id = p_polar_subscription_id for update;
  if locked_owner is distinct from p_user_id
      or (found and previous.polar_customer_id is distinct from p_polar_customer_id) then
    return public.queue_invalid_polar_event(p_polar_subscription_id, p_event_id, p_event_type, p_event_created_at);
  end if;
  if found and previous.last_event_at = p_event_created_at then
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
  if applied and (previous.last_event_at is null or p_event_created_at >= previous.last_event_at) then
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
revoke all on function public.apply_polar_subscription_event(text, text, timestamptz, uuid, text, text, boolean, text, text, text, timestamptz, timestamptz, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.apply_polar_subscription_event(text, text, timestamptz, uuid, text, text, boolean, text, text, text, timestamptz, timestamptz, timestamptz, boolean) to service_role;

-- Short durable lease: crashes/timeouts never delete the pending obligation.
create or replace function public.claim_polar_reconciliation(p_subscription_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.capture_cloud_subscriptions%rowtype;
begin
  perform public.lock_polar_parent(p_subscription_id);
  select * into s from public.capture_cloud_subscriptions where polar_subscription_id = p_subscription_id for update;
  if not found or not s.reconciliation_required then return jsonb_build_object('pending', false); end if;
  if s.reconcile_after > now() then return jsonb_build_object('pending', true); end if;
  update public.capture_cloud_subscriptions set state_version = state_version + 1,
    reconcile_after = now() + interval '30 seconds'
    where polar_subscription_id = p_subscription_id returning * into s;
  return jsonb_build_object('pending', true, 'version', s.state_version::text,
    'userId', s.user_id, 'customerId', s.polar_customer_id, 'productId', s.polar_product_id);
end;
$$;

create or replace function public.finish_polar_reconciliation(p_subscription_id text, p_version bigint, p_snapshot jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare s public.capture_cloud_subscriptions%rowtype;
begin
  perform public.lock_polar_parent(p_subscription_id);
  select * into s from public.capture_cloud_subscriptions where polar_subscription_id = p_subscription_id for update;
  if not found or not s.reconciliation_required or s.state_version <> p_version then return false; end if;
  if p_snapshot->>'polarSubscriptionId' is distinct from p_subscription_id
     or p_snapshot->>'userId' is distinct from s.user_id::text
     or p_snapshot->>'polarCustomerId' is distinct from s.polar_customer_id then
    raise exception 'Polar reconciliation binding mismatch';
  end if;
  -- NOT NULL/check constraints also validate the service-owned normalized payload.
  update public.capture_cloud_subscriptions set
    status = p_snapshot->>'status', plan = p_snapshot->>'plan',
    -- Only the service normalizer supplies snapshots; it checks configured products.
    polar_product_id = p_snapshot->>'polarProductId',
    is_entitled = (p_snapshot->>'isEntitled')::boolean,
    current_period_start = (p_snapshot->>'currentPeriodStart')::timestamptz,
    current_period_end = (p_snapshot->>'currentPeriodEnd')::timestamptz,
    access_expires_at = (p_snapshot->>'accessExpiresAt')::timestamptz,
    cancel_at_period_end = (p_snapshot->>'cancelAtPeriodEnd')::boolean,
    reconciliation_required = false, state_version = state_version + 1, updated_at = now()
  where polar_subscription_id = p_subscription_id;
  -- Keep the webhook watermark: fetch time is NOT provider event chronology.
  return true;
end;
$$;
revoke all on function public.claim_polar_reconciliation(text) from public, anon, authenticated;
revoke all on function public.finish_polar_reconciliation(text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.claim_polar_reconciliation(text) to service_role;
grant execute on function public.finish_polar_reconciliation(text, bigint, jsonb) to service_role;
