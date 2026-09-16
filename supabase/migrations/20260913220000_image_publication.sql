-- STAGE 1: SANDBOX REVIEW / USER-RUN ONLY. NOT APPLIED BY THE AGENT.
-- Read docs/cloud-image-publication.md first. This closes upload admissions;
-- it DOES NOT drain already-admitted uploads and DOES NOT activate the route.
-- Provision private capture-image-candidates via Storage dashboard/API FIRST,
-- max size 2250000; allowed MIME exactly PNG/JPEG/WebP/GIF. Preserve legacy bucket.
-- Apply after 20260913120000_capture_images.sql. Never roll back to old writers.
begin;
set local lock_timeout = '10s';


do $$
begin
  if not exists (select 1 from storage.buckets
    where id = 'capture-image-candidates' and public = false
      and file_size_limit = 2250000
      and allowed_mime_types @> array['image/png','image/jpeg','image/webp','image/gif']::text[]
      and allowed_mime_types <@ array['image/png','image/jpeg','image/webp','image/gif']::text[])
  then raise exception 'Provision private capture-image-candidates with exact size/MIME limits first'; end if;
  if to_regprocedure('storage.allow_any_operation(text[])') is null
     or to_regprocedure('storage.allow_only_operation(text)') is null
  then raise exception 'Storage operation-aware RLS required'; end if;
end $$;

create table public.capture_image_publications (
  user_id uuid not null references auth.users(id) on delete cascade,
  image_id text not null check (image_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  candidate_id uuid not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  content_type text not null check (content_type in ('image/png','image/jpeg','image/webp','image/gif')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 2250000),
  created_at timestamptz not null default now(),
  primary key(user_id,image_id),
  unique(user_id,candidate_id)
);
alter table public.capture_image_publications enable row level security;
revoke all on public.capture_image_publications from public, anon, authenticated;
grant select, insert on public.capture_image_publications to authenticated;
create policy capture_image_publication_owner on public.capture_image_publications
  for all to authenticated
  using (user_id = (select auth.uid()) and exists (
    select 1 from public.capture_cloud_subscriptions s
    where s.user_id = (select auth.uid()) and s.is_entitled and s.access_expires_at > now()
  ))
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.capture_cloud_subscriptions s
    where s.user_id = (select auth.uid()) and s.is_entitled and s.access_expires_at > now()
  ));

-- App-owned operator attestation. No browser role may read or change evidence.
-- Timestamp is a lower bound, NOT proof that the DDL transaction has committed.
create table public.capture_image_cutover (
  singleton boolean primary key default true check (singleton),
  admissions_closed_at timestamptz not null default clock_timestamp(),
  drain_evidence text,
  legacy_evidence text,
  verified_by text,
  activated_at timestamptz,
  check (activated_at is null or (
    activated_at >= admissions_closed_at
    and nullif(btrim(drain_evidence), '') is not null
    and nullif(btrim(legacy_evidence), '') is not null
    and nullif(btrim(verified_by), '') is not null))
);
alter table public.capture_image_cutover enable row level security;
revoke all on public.capture_image_cutover from public, anon, authenticated;
insert into public.capture_image_cutover(singleton) values (true);
create function public.capture_image_cutover_verified() returns boolean
language sql stable security definer set search_path = pg_catalog as $$
  select exists (select 1 from public.capture_image_cutover where singleton
    and activated_at is not null and activated_at >= admissions_closed_at
    and nullif(btrim(drain_evidence), '') is not null
    and nullif(btrim(legacy_evidence), '') is not null
    and nullif(btrim(verified_by), '') is not null)
$$;
revoke all on function public.capture_image_cutover_verified() from public, anon, authenticated;
grant execute on function public.capture_image_cutover_verified() to authenticated;

-- Prevent new/direct publication rows from shadowing frozen legacy logical IDs.
-- Definer reads metadata without operation-dependent Storage RLS hiding legacy
-- rows. Identity is checked BEFORE that read; no caller-selected cross-owner probe.
create function public.capture_image_legacy_guard_fn() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.user_id is distinct from auth.uid() then
    raise exception 'publication owner denied by row-level security' using errcode = '42501';
  end if;
  if not public.capture_image_cutover_verified() then
    raise exception 'image cutover not verified' using errcode = '55000';
  end if;
  if exists (select 1 from storage.objects
    where bucket_id = 'capture-images' and name = new.user_id::text || '/' || new.image_id)
  then raise exception 'legacy image already exists' using errcode = '23514'; end if;
  return new;
end $$;
revoke all on function public.capture_image_legacy_guard_fn() from public, anon, authenticated;
create trigger capture_image_legacy_guard before insert on public.capture_image_publications
  for each row execute function public.capture_image_legacy_guard_fn();


-- Reject fresh legacy permission probes (old app AND direct Storage calls).
-- Pre-admitted provider completions can still finish: stage 2 remains blocked
-- until a provider-verified drain and legacy preservation evidence exist.
create policy capture_images_frozen_insert on storage.objects
  as restrictive for insert to anon, authenticated with check (bucket_id <> 'capture-images');
create policy capture_candidates_tenant on storage.objects
  as restrictive for all to authenticated using (
    bucket_id <> 'capture-image-candidates' or (
      cardinality(storage.foldername(name)) = 1
      and (storage.foldername(name))[1] = (select auth.uid())::text
      and storage.filename(name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists (select 1 from public.capture_cloud_subscriptions s
        where s.user_id = (select auth.uid()) and s.is_entitled and s.access_expires_at > now())
    )
  );
create policy capture_candidates_no_anon on storage.objects
  as restrictive for all to anon using (bucket_id <> 'capture-image-candidates');
create policy capture_candidates_read_operation on storage.objects
  as restrictive for select to anon, authenticated using (
    bucket_id <> 'capture-image-candidates' or
    storage.allow_any_operation(array['object.get_authenticated_info','object.get_authenticated'])
  );
create policy capture_candidates_insert_operation on storage.objects
  as restrictive for insert to anon, authenticated with check (
    bucket_id <> 'capture-image-candidates' or (
      public.capture_image_cutover_verified() and storage.allow_only_operation('object.upload'))
  );
create policy capture_candidates_no_update on storage.objects
  as restrictive for update to anon, authenticated
  using (bucket_id <> 'capture-image-candidates') with check (bucket_id <> 'capture-image-candidates');
create policy capture_candidates_no_delete on storage.objects
  as restrictive for delete to anon, authenticated using (bucket_id <> 'capture-image-candidates');
create policy capture_candidates_select on storage.objects
  for select to authenticated using (bucket_id = 'capture-image-candidates');
create policy capture_candidates_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'capture-image-candidates');

-- No fallback on missing schema, and installing stage 1 NEVER activates routes.
-- Catalog checks are drift alarms, not proof of hosted policy semantics/drain.
create function public.capture_image_publication_ready() returns boolean
language sql stable security definer set search_path = pg_catalog as $$
  select public.capture_image_cutover_verified()
  and exists (select 1 from pg_trigger where tgrelid = 'public.capture_image_publications'::regclass
    and tgname = 'capture_image_legacy_guard' and tgenabled = 'O')
  and exists (select 1 from pg_class where oid = 'public.capture_image_publications'::regclass and relrowsecurity)
  and exists (select 1 from pg_class where oid = 'storage.objects'::regclass and relrowsecurity)
  and exists (select 1 from storage.buckets where id = 'capture-images' and public = false)
  and (select count(*) from pg_policy where polrelid = 'storage.objects'::regclass
    and not polpermissive and polname in (
      'capture_images_tenant','capture_images_no_anon','capture_images_read_operation',
      'capture_images_insert_operation','capture_images_no_update','capture_images_no_delete',
      'capture_images_frozen_insert','capture_candidates_tenant','capture_candidates_no_anon',
      'capture_candidates_read_operation','capture_candidates_insert_operation',
      'capture_candidates_no_update','capture_candidates_no_delete')) = 13
  and exists (select 1 from storage.buckets where id = 'capture-image-candidates' and public = false
    and file_size_limit = 2250000
    and allowed_mime_types @> array['image/png','image/jpeg','image/webp','image/gif']::text[]
    and allowed_mime_types <@ array['image/png','image/jpeg','image/webp','image/gif']::text[])
$$;
revoke all on function public.capture_image_publication_ready() from public, anon, authenticated;
grant execute on function public.capture_image_publication_ready() to authenticated;
-- Explicit legacy mode, never inferred from a missing fresh configuration.
create function public.capture_image_publication_config() returns jsonb
language sql stable security definer set search_path = pg_catalog as $$
  select case when public.capture_image_publication_ready()
    and to_regclass('public.capture_image_fresh_activation') is null then
    jsonb_build_object('mode','legacy-cutover','bucket','capture-image-candidates') else null end
$$;
revoke all on function public.capture_image_publication_config() from public, anon, authenticated;
grant execute on function public.capture_image_publication_config() to authenticated;
do $$ begin
  if public.capture_image_publication_ready() then
    raise exception 'Stage 1 must remain inactive';
  end if;
end $$;
commit;
