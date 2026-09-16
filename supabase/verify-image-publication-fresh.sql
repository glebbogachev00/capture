-- Read-only sandbox verification; never substitutes for namespace provenance or live bytes.
begin read only;
do $$ begin
  if not public.capture_image_publication_ready()
    or public.capture_image_publication_config() is distinct from
      '{"mode":"fresh","bucket":"capture-image-candidates-fresh-20260914"}'::jsonb then
    raise exception 'Fresh readiness/config mismatch'; end if;
  if to_regclass('public.capture_image_cutover') is not null
    or exists(select 1 from pg_trigger where tgrelid='public.capture_image_publications'::regclass and not tgisinternal)
    or exists(select 1 from pg_policy where polrelid='storage.objects'::regclass and polname='capture_images_frozen_insert') then
    raise exception 'Mixed legacy-cutover setup'; end if;
  if has_table_privilege('authenticated','public.capture_image_publications','UPDATE')
    or has_table_privilege('authenticated','public.capture_image_publications','DELETE')
    or has_table_privilege('anon','public.capture_image_publications','SELECT')
    or has_table_privilege('anon','public.capture_image_publications','INSERT')
    or has_table_privilege('authenticated','public.capture_image_fresh_activation','INSERT')
    or has_table_privilege('authenticated','public.capture_image_fresh_activation','UPDATE')
    or has_table_privilege('authenticated','public.capture_image_fresh_activation','DELETE')
    or has_function_privilege('anon','public.capture_image_publication_config()','EXECUTE') then
    raise exception 'Unsafe image privileges'; end if;
end $$;
select public.capture_image_publication_config() as active_configuration;
select count(*) as publication_rows from public.capture_image_publications;
select 'PASS: fresh structural checks; run bounded live acceptance next. Legacy access intentionally not provided.' as result;
commit;