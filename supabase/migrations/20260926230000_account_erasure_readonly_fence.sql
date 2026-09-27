-- Keep exact-owner recovery reads compatible with PostgREST read-only transactions.
--
-- The original read fence selected the erasure row FOR SHARE. PostgreSQL rejects
-- row locks in read-only transactions, so ordinary authenticated board reads
-- failed before backup restore could start. The owner advisory transaction lock
-- provides the same prepare/confirm ordering without mutating or row-locking data.
begin;
set local lock_timeout = '10s';

create or replace function public.capture_account_read_allowed(p_user_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_stage text;
  v_caller uuid := auth.uid();
begin
  if p_user_id is null then return false; end if;
  if v_caller is not null and v_caller is distinct from p_user_id then
    raise insufficient_privilege using message = 'exact owner required';
  end if;

  -- Read transactions may take advisory transaction locks. Sharing the same
  -- owner lock as prepare/confirm makes either the read or the erasure fence win
  -- cleanly, while the plain SELECT remains valid in a read-only transaction.
  perform public.capture_account_owner_lock(p_user_id);
  select stage into v_stage
    from public.capture_account_erasure_operations
    where owner_id = p_user_id and stage <> 'complete';

  if not found then return true; end if;
  return v_stage = 'prepared';
end;
$$;

revoke all on function public.capture_account_read_allowed(uuid) from public, anon;
grant execute on function public.capture_account_read_allowed(uuid) to authenticated, service_role;

commit;
