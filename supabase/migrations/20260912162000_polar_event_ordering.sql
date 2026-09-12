-- Make webhook ordering stable for projects that already applied
-- 20260911170000_polar_entitlements.sql. A distinct delivery with the same
-- timestamp must not overwrite state that was already accepted.

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
begin
  if p_status not in ('trialing', 'active', 'past_due', 'canceled', 'revoked', 'paused', 'inactive') then
    raise exception 'invalid subscription status';
  end if;
  if p_plan is not null and p_plan not in ('monthly', 'yearly') then
    raise exception 'invalid subscription plan';
  end if;
  if p_event_id = '' or p_polar_subscription_id = '' or p_polar_customer_id = '' then
    raise exception 'missing Polar identifier';
  end if;
  if exists (
    select 1
    from public.capture_cloud_subscriptions
    where polar_subscription_id = p_polar_subscription_id
      and (user_id <> p_user_id or polar_customer_id <> p_polar_customer_id)
  ) then
    raise exception 'Polar subscription ownership mismatch';
  end if;

  insert into public.polar_webhook_events (
    event_id, event_type, user_id, polar_subscription_id, event_created_at
  ) values (
    p_event_id, p_event_type, p_user_id, p_polar_subscription_id, p_event_created_at
  )
  on conflict (event_id) do nothing;

  if not found then
    return false;
  end if;

  insert into public.capture_cloud_subscriptions (
    polar_subscription_id,
    user_id,
    status,
    plan,
    is_entitled,
    polar_customer_id,
    polar_product_id,
    current_period_start,
    current_period_end,
    access_expires_at,
    cancel_at_period_end,
    last_event_at,
    updated_at
  ) values (
    p_polar_subscription_id,
    p_user_id,
    p_status,
    p_plan,
    p_is_entitled,
    p_polar_customer_id,
    p_polar_product_id,
    p_current_period_start,
    p_current_period_end,
    p_access_expires_at,
    p_cancel_at_period_end,
    p_event_created_at,
    now()
  )
  on conflict (polar_subscription_id) do update set
    status = excluded.status,
    plan = excluded.plan,
    is_entitled = excluded.is_entitled,
    polar_product_id = excluded.polar_product_id,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    access_expires_at = excluded.access_expires_at,
    cancel_at_period_end = excluded.cancel_at_period_end,
    last_event_at = excluded.last_event_at,
    updated_at = now()
  where public.capture_cloud_subscriptions.user_id = excluded.user_id
    and public.capture_cloud_subscriptions.polar_customer_id = excluded.polar_customer_id
    and public.capture_cloud_subscriptions.last_event_at < excluded.last_event_at;

  return true;
end;
$$;

revoke all on function public.apply_polar_subscription_event(
  text, text, timestamptz, uuid, text, text, boolean, text, text, text,
  timestamptz, timestamptz, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.apply_polar_subscription_event(
  text, text, timestamptz, uuid, text, text, boolean, text, text, text,
  timestamptz, timestamptz, timestamptz, boolean
) to service_role;
