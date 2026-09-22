-- Exact-owner backup reads survive billing expiry; ordinary reads/writes and all
-- writes remain entitlement-gated by the application and Storage RLS.
begin;
set local lock_timeout = '10s';

-- Upgrade already-provisioned quota tables as well as fresh installs. Editing
-- the earlier migration alone would leave its generated CHECK constraints and
-- policy rows unchanged on an existing Cloud database.
alter table public.capture_cloud_owner_quotas
  drop constraint if exists capture_cloud_owner_quotas_scope_check;
alter table public.capture_cloud_owner_quotas
  add constraint capture_cloud_owner_quotas_scope_check
  check (scope in ('managed_ai', 'board_read', 'board_write', 'backup_read'));
alter table public.capture_cloud_quota_policies
  drop constraint if exists capture_cloud_quota_policies_scope_check;
alter table public.capture_cloud_quota_policies
  add constraint capture_cloud_quota_policies_scope_check
  check (scope in ('managed_ai', 'board_read', 'board_write', 'backup_read'));
insert into public.capture_cloud_quota_policies (scope, request_limit, window_seconds)
values ('backup_read', 2000, 3600)
on conflict (scope) do nothing;

-- Fresh activation fingerprints every publication/fresh Storage policy. Hold
-- and re-attest that app-owned row in this transaction while policy definitions
-- change; never touch managed Storage triggers or object metadata.
do $$ begin
  if to_regclass('public.capture_image_fresh_activation') is not null then
    lock table public.capture_image_fresh_activation in access exclusive mode;
    drop trigger if exists capture_image_fresh_fixed on public.capture_image_fresh_activation;
  end if;
end $$;

-- Publication metadata is readable by its exact owner without billing. Inserts
-- still require current entitlement, so backup access cannot publish/overwrite.
drop policy if exists capture_image_publication_owner on public.capture_image_publications;
drop policy if exists capture_image_publication_owner_select on public.capture_image_publications;
drop policy if exists capture_image_publication_owner_insert on public.capture_image_publications;
create policy capture_image_publication_owner_select on public.capture_image_publications
  for select to authenticated
  using (user_id = (select auth.uid()) and public.capture_image_publication_ready());
create policy capture_image_publication_owner_insert on public.capture_image_publications
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.capture_image_publication_ready()
    and exists (
      select 1 from public.capture_cloud_subscriptions s
      where s.user_id = (select auth.uid())
        and s.is_entitled and s.access_expires_at > now()
    )
  );

-- Frozen legacy bytes: tenant/path checks are independent of billing for SELECT.
-- The additional restrictive INSERT policy preserves the previous write gate.
drop policy if exists capture_images_tenant on storage.objects;
create policy capture_images_tenant on storage.objects
  as restrictive for all to authenticated
  using (
    bucket_id <> 'capture-images' or (
      cardinality(storage.foldername(name)) = 1
      and (storage.foldername(name))[1] = (select auth.uid())::text
      and storage.filename(name) ~ '^[A-Za-z0-9_-]{1,64}$'
    )
  );
drop policy if exists capture_images_write_entitlement on storage.objects;
create policy capture_images_write_entitlement on storage.objects
  as restrictive for insert to authenticated
  with check (
    bucket_id <> 'capture-images' or exists (
      select 1 from public.capture_cloud_subscriptions s
      where s.user_id = (select auth.uid())
        and s.is_entitled and s.access_expires_at > now()
    )
  );

-- Legacy-cutover candidates use UUID physical names.
drop policy if exists capture_candidates_tenant on storage.objects;
create policy capture_candidates_tenant on storage.objects
  as restrictive for all to authenticated
  using (
    bucket_id <> 'capture-image-candidates' or (
      cardinality(storage.foldername(name)) = 1
      and (storage.foldername(name))[1] = (select auth.uid())::text
      and storage.filename(name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
  );
drop policy if exists capture_candidates_write_entitlement on storage.objects;
create policy capture_candidates_write_entitlement on storage.objects
  as restrictive for insert to authenticated
  with check (
    bucket_id <> 'capture-image-candidates' or exists (
      select 1 from public.capture_cloud_subscriptions s
      where s.user_id = (select auth.uid())
        and s.is_entitled and s.access_expires_at > now()
    )
  );

-- Fresh candidates keep readiness/path checks on reads and billing on inserts.
drop policy if exists capture_fresh_tenant on storage.objects;
create policy capture_fresh_tenant on storage.objects
  as restrictive for all to authenticated
  using (
    bucket_id <> 'capture-image-candidates-fresh-20260914' or (
      public.capture_image_publication_ready()
      and cardinality(storage.foldername(name)) = 1
      and (storage.foldername(name))[1] = (select auth.uid())::text
      and storage.filename(name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
  );
drop policy if exists capture_fresh_write_entitlement on storage.objects;
create policy capture_fresh_write_entitlement on storage.objects
  as restrictive for insert to authenticated
  with check (
    bucket_id <> 'capture-image-candidates-fresh-20260914' or exists (
      select 1 from public.capture_cloud_subscriptions s
      where s.user_id = (select auth.uid())
        and s.is_entitled and s.access_expires_at > now()
    )
  );

-- Re-attest and restore the immutable fresh activation guard when fresh mode is
-- installed. Legacy mode has no activation table and skips this block.
do $$ begin
  if to_regclass('public.capture_image_fresh_activation') is not null then
    update public.capture_image_fresh_activation
      set policy_fingerprint = public.capture_image_fresh_policy_fingerprint()
      where singleton;
    create trigger capture_image_fresh_fixed
      before insert or update or delete on public.capture_image_fresh_activation
      for each row execute function public.capture_image_fresh_fixed_fn();
    if not public.capture_image_publication_ready() then
      raise exception 'Backup-read policy activation failed';
    end if;
  end if;
end $$;

commit;
