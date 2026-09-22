-- Read-only verification after 20260922200000_image_storage_admissions.sql.
-- Structural/grant evidence only; it does not prove hosted Storage admission,
-- provider quiescence, backend bytes, or complete provider inventory.
begin read only;
do $$
declare v_fresh_attested boolean;
begin
  if not public.capture_image_admission_ready() then
    raise exception 'Image admission readiness failed';
  end if;
  if public.capture_image_publication_config() is null then
    raise exception 'Image publication configuration missing';
  end if;
  if has_table_privilege('authenticated','public.capture_image_operations','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','public.capture_image_owner_usage','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','public.capture_image_storage_policy','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','public.capture_image_publications','INSERT') then
    raise exception 'Authenticated image mutation privilege remains';
  end if;
  if not has_table_privilege('service_role','public.capture_image_storage_policy','SELECT')
     or not has_table_privilege('service_role','public.capture_image_storage_policy','UPDATE')
     or has_table_privilege('service_role','public.capture_image_storage_policy','INSERT')
     or has_table_privilege('service_role','public.capture_image_storage_policy','DELETE')
     or has_table_privilege('service_role','public.capture_image_storage_policy','TRUNCATE')
     or has_table_privilege('service_role','public.capture_image_storage_policy','REFERENCES')
     or has_table_privilege('service_role','public.capture_image_storage_policy','TRIGGER')
     or exists(select 1 from pg_catalog.pg_class class,
       lateral pg_catalog.aclexplode(coalesce(class.relacl,pg_catalog.acldefault('r',class.relowner))) acl
       where class.oid='public.capture_image_storage_policy'::regclass
         and acl.grantee in (0,
           (select oid from pg_catalog.pg_roles where rolname='anon'),
           (select oid from pg_catalog.pg_roles where rolname='authenticated'))) then
    raise exception 'Image admission singleton policy privilege mismatch';
  end if;
  if not has_function_privilege('service_role','public.reserve_capture_image_storage(uuid,text,text,text,integer)','EXECUTE')
     or not has_function_privilege('service_role','public.finalize_capture_image_storage(uuid,uuid,uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.release_capture_image_storage_reservation(uuid,uuid,uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.abandon_capture_image_storage_reservation(uuid,uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.reserve_capture_image_storage(uuid,text,text,text,integer)','EXECUTE')
     or has_function_privilege('authenticated','public.finalize_capture_image_storage(uuid,uuid,uuid)','EXECUTE') then
    raise exception 'Image admission function grant mismatch';
  end if;
  if not exists(select 1 from pg_catalog.pg_policy policy
      where policy.polrelid='storage.objects'::regclass
        and policy.polname='capture_image_app_only_insert'
        and not policy.polpermissive and policy.polcmd='a'
        and policy.polroles=array[(select oid from pg_catalog.pg_roles where rolname='authenticated')]::oid[]
        and policy.polqual is null
        and pg_catalog.pg_get_expr(policy.polwithcheck,policy.polrelid)=
          '(bucket_id <> ALL (ARRAY[''capture-images''::text, ''capture-image-candidates''::text, ''capture-image-candidates-fresh-20260914''::text]))')
     or exists(select 1 from pg_policy
      where polrelid='storage.objects'::regclass
        and polname in ('capture_candidates_insert','capture_fresh_insert')) then
    raise exception 'Direct authenticated Storage admission not closed';
  end if;
  if not exists(select 1 from pg_catalog.pg_trigger trigger
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
$capture_guard$) then
    raise exception 'Publication operation guard missing';
  end if;
  if (select count(*) from public.capture_image_storage_policy)<>1
     or not exists(select 1 from public.capture_image_storage_policy policy
       where policy.singleton and policy.max_objects=256 and policy.max_bytes=576000000
         and policy.max_object_bytes=2250000 and policy.lease_seconds=120
         and not policy.stale_reclaim_enabled
         and policy.admission_fingerprint=public.capture_image_admission_contract_fingerprint()) then
    raise exception 'Image admission policy differs from source launch default';
  end if;
  if to_regclass('public.capture_image_fresh_activation') is not null then
    execute 'select exists(select 1 from public.capture_image_fresh_activation activation
      where activation.singleton
        and activation.policy_fingerprint=public.capture_image_fresh_policy_fingerprint())'
      into v_fresh_attested;
    if not v_fresh_attested then
      raise exception 'Fresh image activation admission fingerprint mismatch';
    end if;
  end if;
  if exists(
    select 1 from public.capture_image_owner_usage usage
    full join (
      select owner_id,count(*)::integer as objects,sum(byte_size)::bigint as bytes
      from public.capture_image_operations
      where state not in ('released','deleted') group by owner_id
    ) operation using(owner_id)
    where coalesce(usage.reserved_objects,0)<>coalesce(operation.objects,0)
       or coalesce(usage.reserved_bytes,0)<>coalesce(operation.bytes,0)
  ) then raise exception 'Image owner usage does not match durable operations'; end if;
end $$;
select public.capture_image_publication_config() as active_configuration;
select policy.polcmd,policy.polpermissive,
  (select array_agg(role.rolname order by role.rolname)
    from unnest(policy.polroles) role_oid join pg_roles role on role.oid=role_oid) as roles,
  pg_get_expr(policy.polqual,policy.polrelid) as using_expression,
  pg_get_expr(policy.polwithcheck,policy.polrelid) as with_check_expression
  from pg_policy policy where policy.polrelid='storage.objects'::regclass
    and policy.polname='capture_image_app_only_insert';
select trigger.tgenabled,trigger.tgtype,pg_get_triggerdef(trigger.oid,true) as trigger_definition,
  md5(pg_get_functiondef(trigger.tgfoid)) as trigger_function_fingerprint
  from pg_trigger trigger where trigger.tgrelid='public.capture_image_publications'::regclass
    and trigger.tgname='capture_image_publication_admission_guard' and not trigger.tgisinternal;
select max_objects,max_bytes,max_object_bytes,lease_seconds,stale_reclaim_enabled,
  admission_fingerprint=public.capture_image_admission_contract_fingerprint() as contract_attested
  from public.capture_image_storage_policy where singleton;
select count(*) as operation_rows from public.capture_image_operations;
select 'PASS: image admission ledger/grants/RLS/accounting structure; hosted Storage contract still requires attestation' as result;
commit;
