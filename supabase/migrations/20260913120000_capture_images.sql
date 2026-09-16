-- Provision capture-images using the Storage API/dashboard FIRST; see
-- docs/cloud-images.md. Do not insert/update Storage metadata via SQL.
-- Apply after the board and subscription migrations. No service-role app client.
begin;

do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'capture-images' and public = false
      and file_size_limit = 2250000
      and allowed_mime_types @> array['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]
      and allowed_mime_types <@ array['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]
  ) then
    raise exception 'Provision private capture-images bucket with exact size/MIME limits first';
  end if;
  if to_regprocedure('storage.allow_any_operation(text[])') is null
     or to_regprocedure('storage.allow_only_operation(text)') is null then
    raise exception 'Storage operation-aware RLS helper required; update Storage before applying';
  end if;
end;
$$;

-- A restrictive policy prevents an unrelated permissive Storage policy from
-- exposing this bucket. Other buckets retain their existing policies.
-- ALL's USING also supplies WITH CHECK when it is not explicitly specified.
drop policy if exists capture_images_tenant on storage.objects;
create policy capture_images_tenant on storage.objects
  as restrictive for all to authenticated
  using (
    bucket_id <> 'capture-images' or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and cardinality(storage.foldername(name)) = 1
      and storage.filename(name) ~ '^[A-Za-z0-9_-]{1,64}$'
      and exists (
        select 1 from public.capture_cloud_subscriptions s
        where s.user_id = (select auth.uid())
          and s.is_entitled = true
          and s.access_expires_at > now()
      )
    )
  );

-- anon must not query the subscriptions table (it has no SELECT grant).
drop policy if exists capture_images_no_anon on storage.objects;
create policy capture_images_no_anon on storage.objects
  as restrictive for all to anon
  using (bucket_id <> 'capture-images');

-- Signed URLs would outlive entitlement checks; allow only authenticated
-- download and info (the metadata-only HEAD proxy). No listing/signing/copy.
drop policy if exists capture_images_read_operation on storage.objects;
create policy capture_images_read_operation on storage.objects
  as restrictive for select to anon, authenticated
  using (
    bucket_id <> 'capture-images' or
    storage.allow_any_operation(array['object.get_authenticated_info', 'object.get_authenticated'])
  );

-- Block signed-upload URLs too: their bearer capability would survive expiry.
drop policy if exists capture_images_insert_operation on storage.objects;
create policy capture_images_insert_operation on storage.objects
  as restrictive for insert to anon, authenticated
  with check (
    bucket_id <> 'capture-images' or storage.allow_only_operation('object.upload')
  );

drop policy if exists capture_images_no_update on storage.objects;
create policy capture_images_no_update on storage.objects
  as restrictive for update to anon, authenticated
  using (bucket_id <> 'capture-images')
  with check (bucket_id <> 'capture-images');
drop policy if exists capture_images_no_delete on storage.objects;
create policy capture_images_no_delete on storage.objects
  as restrictive for delete to anon, authenticated
  using (bucket_id <> 'capture-images');

drop policy if exists capture_images_select on storage.objects;
create policy capture_images_select on storage.objects
  for select to authenticated using (bucket_id = 'capture-images');
drop policy if exists capture_images_insert on storage.objects;
create policy capture_images_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'capture-images');

commit;
