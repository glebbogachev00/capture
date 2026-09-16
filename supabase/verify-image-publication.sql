-- SANDBOX USER-RUN verification after applying the reviewed migration.
-- Read-only: no notes/photos/publications/entitlements are changed.
begin read only;
do $$
begin
  if not public.capture_image_publication_ready() then
    raise exception 'BLOCKED: stage 2 operator evidence or schema/bucket not ready'; end if;
  if has_table_privilege('authenticated','public.capture_image_publications','UPDATE')
     or has_table_privilege('authenticated','public.capture_image_publications','DELETE')
     or has_table_privilege('anon','public.capture_image_publications','SELECT')
     or has_table_privilege('anon','public.capture_image_publications','INSERT') then
    raise exception 'FAIL: unsafe publication privileges'; end if;
  if not has_table_privilege('authenticated','public.capture_image_publications','SELECT')
     or not has_table_privilege('authenticated','public.capture_image_publications','INSERT') then
    raise exception 'FAIL: missing publication privileges'; end if;
  if has_function_privilege('anon','public.capture_image_publication_ready()','EXECUTE')
     or has_function_privilege('authenticated','public.capture_image_legacy_guard_fn()','EXECUTE') then
    raise exception 'FAIL: unsafe function privileges'; end if;
  if not exists (select 1 from pg_class where oid='storage.objects'::regclass and relrowsecurity)
     or not exists (select 1 from storage.buckets where id='capture-images' and public=false) then
    raise exception 'FAIL: legacy Storage protection missing'; end if;
  if (select count(*) from pg_policy where polrelid='storage.objects'::regclass
    and not polpermissive and polname in (
      'capture_images_tenant','capture_images_no_anon','capture_images_read_operation',
      'capture_images_insert_operation','capture_images_no_update','capture_images_no_delete',
      'capture_images_frozen_insert','capture_candidates_tenant','capture_candidates_no_anon',
      'capture_candidates_read_operation','capture_candidates_insert_operation',
      'capture_candidates_no_update','capture_candidates_no_delete')) <> 13 then
    raise exception 'FAIL: required restrictive policies missing'; end if;
end $$;
select 'PASS: operator activation and structural checks present; hosted bytes/API/concurrency still require acceptance' as result;
select tgname, tgenabled from pg_trigger
where tgname = 'capture_image_legacy_guard';
-- Counts only; no user identifiers or image content returned.
select count(*) as retained_legacy_metadata_rows from storage.objects where bucket_id='capture-images';
select count(*) as publication_rows from public.capture_image_publications;
commit;
