-- FRESH sandbox pwpklwihwmxdehfdsoij ONLY. User-run after review; NOT db push.
-- Alternative to legacy stage 1 + stage 2, NOT an additional migration.
-- FIRST provision a NEW private capture-image-candidates-fresh-20260914 via
-- dashboard/API, 2250000 bytes, MIME exactly PNG/JPEG/WebP/GIF. Never recreate.
-- No prior writers, signed capabilities, or service-role uploads may target it.
-- Blank operator fields abort the entire transaction. Reports are not drain evidence.
begin;
set local lock_timeout = '10s';
create temporary table fresh_operator(reference text, operator_name text) on commit drop;
do $$
declare
  namespace_reference text := '';
  operator_name text := '';
begin
  if length(btrim(namespace_reference)) < 20 or length(btrim(operator_name)) < 3 then
    raise exception 'BLOCKED: review never-used namespace provenance and closed admissions since provisioning';
  end if;
  if to_regclass('public.capture_image_publications') is not null
    or to_regclass('public.capture_image_cutover') is not null
    or to_regclass('public.capture_image_fresh_activation') is not null
    or to_regprocedure('public.capture_image_publication_ready()') is not null then
    raise exception 'Publication already installed: do not mix fresh and legacy setup';
  end if;
  if to_regclass('public.capture_cloud_subscriptions') is null
    or to_regprocedure('storage.allow_any_operation(text[])') is null
    or to_regprocedure('storage.allow_only_operation(text)') is null then
    raise exception 'Billing and operation-aware Storage prerequisites missing';
  end if;
  -- This specific sandbox has ONLY the eight original image policies. Unknown
  -- policies might have admitted new-bucket requests before this transaction.
  if (select count(*) from pg_policy where polrelid='storage.objects'::regclass) <> 8
    or (select count(*) from pg_policy where polrelid='storage.objects'::regclass
      and polname in ('capture_images_tenant','capture_images_no_anon',
        'capture_images_read_operation','capture_images_insert_operation',
        'capture_images_no_update','capture_images_no_delete',
        'capture_images_select','capture_images_insert')) <> 8
    or exists (select 1 from pg_policy where polrelid='storage.objects'::regclass
      and polpermissive and (polname not in ('capture_images_select','capture_images_insert')
        or (polname='capture_images_select' and polcmd <> 'r')
        or (polname='capture_images_insert' and polcmd <> 'a')
        or polroles <> array[(select oid from pg_roles where rolname='authenticated')]::oid[]
        or coalesce(pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid))
          <> '(bucket_id = ''capture-images''::text)')) then
    raise exception 'Expected original eight scoped image policies; stop and inspect';
  end if;
  if not exists (select 1 from pg_class where oid='storage.objects'::regclass and relrowsecurity) then
    raise exception 'Storage RLS required'; end if;
  if not exists (select 1 from storage.buckets where id='capture-image-candidates-fresh-20260914'
    and public=false and file_size_limit=2250000 and created_at is not null
    and allowed_mime_types @> array['image/png','image/jpeg','image/webp','image/gif']::text[]
    and allowed_mime_types <@ array['image/png','image/jpeg','image/webp','image/gif']::text[]) then
    raise exception 'Fresh bucket missing or size/MIME/privacy mismatch'; end if;
  if exists (select 1 from storage.objects where bucket_id='capture-image-candidates-fresh-20260914') then
    raise exception 'Fresh candidate namespace not empty; never clean and reuse it'; end if;
  insert into fresh_operator values (namespace_reference, operator_name);
end $$;

create table public.capture_image_publications (
  user_id uuid not null references auth.users(id) on delete cascade,
  image_id text not null check (image_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  candidate_id uuid not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  content_type text not null check (content_type in ('image/png','image/jpeg','image/webp','image/gif')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 2250000),
  created_at timestamptz not null default now(),
  primary key(user_id,image_id), unique(user_id,candidate_id)
);
alter table public.capture_image_publications enable row level security;
revoke all on public.capture_image_publications from public, anon, authenticated;
grant select, insert on public.capture_image_publications to authenticated;

create table public.capture_image_fresh_activation (
  singleton boolean primary key default true check(singleton),
  mode text not null check(mode='fresh'),
  bucket_id text not null check(bucket_id='capture-image-candidates-fresh-20260914'),
  bucket_created_at timestamptz not null,
  namespace_evidence text not null check(length(btrim(namespace_evidence)) >= 20),
  verified_by text not null check(length(btrim(verified_by)) >= 3),
  initially_empty boolean not null check(initially_empty),
  activated_at timestamptz not null,
  policy_fingerprint text not null
);
alter table public.capture_image_fresh_activation enable row level security;
revoke all on public.capture_image_fresh_activation from public, anon, authenticated;

-- Fingerprint the fixed fresh policy definitions, roles and commands, not just names.
create function public.capture_image_fresh_policy_fingerprint() returns text
language sql stable security definer set search_path=pg_catalog as $$
  select md5(string_agg(polname || ':' || polcmd::text || ':' || polpermissive::text || ':' || polroles::text
    || ':' || coalesce(pg_get_expr(polqual,polrelid),'') || ':' || coalesce(pg_get_expr(polwithcheck,polrelid),''), '|' order by polname))
  from pg_policy where (polrelid='storage.objects'::regclass and polname like 'capture_fresh_%')
    or polrelid='public.capture_image_publications'::regclass
$$;
revoke all on function public.capture_image_fresh_policy_fingerprint() from public, anon, authenticated;

create function public.capture_image_publication_ready() returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select exists (select 1 from public.capture_image_fresh_activation a
    join storage.buckets b on b.id=a.bucket_id and b.created_at=a.bucket_created_at
    where a.singleton and a.mode='fresh' and a.bucket_id='capture-image-candidates-fresh-20260914'
      and a.initially_empty and a.activated_at is not null
      and a.policy_fingerprint=public.capture_image_fresh_policy_fingerprint()
      and b.public=false and b.file_size_limit=2250000
      and b.allowed_mime_types @> array['image/png','image/jpeg','image/webp','image/gif']::text[]
      and b.allowed_mime_types <@ array['image/png','image/jpeg','image/webp','image/gif']::text[])
    and (select count(*) from pg_class where oid in ('storage.objects'::regclass,
      'public.capture_image_publications'::regclass,'public.capture_image_fresh_activation'::regclass) and relrowsecurity)=3
    and exists(select 1 from pg_trigger where tgrelid='public.capture_image_fresh_activation'::regclass
      and tgname='capture_image_fresh_fixed' and tgenabled='O')
    and to_regclass('public.capture_image_cutover') is null
$$;
revoke all on function public.capture_image_publication_ready() from public, anon, authenticated;
grant execute on function public.capture_image_publication_ready() to authenticated;
create function public.capture_image_publication_config() returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
  select case when public.capture_image_publication_ready() then
    jsonb_build_object('mode',mode,'bucket',bucket_id) else null end
    from public.capture_image_fresh_activation where singleton
$$;
revoke all on function public.capture_image_publication_config() from public, anon, authenticated;
grant execute on function public.capture_image_publication_config() to authenticated;

create policy capture_image_publication_owner on public.capture_image_publications
  for all to authenticated using (user_id=(select auth.uid()) and public.capture_image_publication_ready()
    and exists(select 1 from public.capture_cloud_subscriptions s where s.user_id=(select auth.uid())
      and s.is_entitled and s.access_expires_at > now()))
  with check (user_id=(select auth.uid()) and public.capture_image_publication_ready()
    and exists(select 1 from public.capture_cloud_subscriptions s where s.user_id=(select auth.uid())
      and s.is_entitled and s.access_expires_at > now()));
-- Fresh deliberately has NO legacy collision trigger or old-bucket freeze.
create policy capture_fresh_tenant on storage.objects
  as restrictive for all to authenticated using (
    bucket_id <> 'capture-image-candidates-fresh-20260914' or (
      public.capture_image_publication_ready()
      and cardinality(storage.foldername(name))=1
      and (storage.foldername(name))[1]=(select auth.uid())::text
      and storage.filename(name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists(select 1 from public.capture_cloud_subscriptions s where s.user_id=(select auth.uid())
        and s.is_entitled and s.access_expires_at > now())));
create policy capture_fresh_no_anon on storage.objects
  as restrictive for all to anon using (bucket_id <> 'capture-image-candidates-fresh-20260914');
create policy capture_fresh_read_operation on storage.objects
  as restrictive for select to anon, authenticated using (bucket_id <> 'capture-image-candidates-fresh-20260914'
    or storage.allow_any_operation(array['object.get_authenticated_info','object.get_authenticated']));
create policy capture_fresh_insert_operation on storage.objects
  as restrictive for insert to anon, authenticated with check (bucket_id <> 'capture-image-candidates-fresh-20260914'
    or (public.capture_image_publication_ready() and storage.allow_only_operation('object.upload')));
create policy capture_fresh_no_update on storage.objects
  as restrictive for update to anon, authenticated using (bucket_id <> 'capture-image-candidates-fresh-20260914')
    with check (bucket_id <> 'capture-image-candidates-fresh-20260914');
create policy capture_fresh_no_delete on storage.objects
  as restrictive for delete to anon, authenticated using (bucket_id <> 'capture-image-candidates-fresh-20260914');
create policy capture_fresh_select on storage.objects
  for select to authenticated using (bucket_id='capture-image-candidates-fresh-20260914');
create policy capture_fresh_insert on storage.objects
  for insert to authenticated with check (bucket_id='capture-image-candidates-fresh-20260914');

-- Only app-owned state has a trigger. No managed Storage triggers/ALTER/DML.
-- Activation is one-way and fixed; namespace reuse is NEVER an in-place repair.
create function public.capture_image_fresh_fixed_fn() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_op <> 'INSERT' then raise exception 'Fresh activation is immutable'; end if;
  if exists(select 1 from public.capture_image_publications)
    or exists(select 1 from storage.objects where bucket_id=new.bucket_id) then
    raise exception 'Fresh publications/candidates not empty'; end if;
  if new.policy_fingerprint is distinct from public.capture_image_fresh_policy_fingerprint()
    or not exists(select 1 from storage.buckets where id=new.bucket_id and created_at=new.bucket_created_at) then
    raise exception 'Fresh activation configuration mismatch'; end if;
  return new;
end $$;
revoke all on function public.capture_image_fresh_fixed_fn() from public, anon, authenticated;
create trigger capture_image_fresh_fixed before insert or update or delete on public.capture_image_fresh_activation
  for each row execute function public.capture_image_fresh_fixed_fn();

-- All admissions remain closed before this one-time empty-state assertion.
insert into public.capture_image_fresh_activation(singleton,mode,bucket_id,bucket_created_at,
  namespace_evidence,verified_by,initially_empty,activated_at,policy_fingerprint)
select true,'fresh',b.id,b.created_at,o.reference,o.operator_name,true,clock_timestamp(),
  public.capture_image_fresh_policy_fingerprint()
from storage.buckets b cross join fresh_operator o where b.id='capture-image-candidates-fresh-20260914';
do $$ begin
  if not public.capture_image_publication_ready() then raise exception 'Fresh readiness failed; rollback'; end if;
end $$;
commit;