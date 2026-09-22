"""Executed inside test-image-publication-sql.py --fresh's disposable cluster."""
import concurrent.futures
import uuid
from pathlib import Path
from typing import Callable

# Supplied by the disposable cluster runner, never external credentials.
ROOT: Path = globals()['ROOT']
A: str = globals()['A']
B: str = globals()['B']
ok: Callable = globals()['ok']
denied: Callable = globals()['denied']
sql: Callable = globals()['sql']
user: Callable = globals()['user']

bucket = 'capture-image-candidates-fresh-20260914'
apply = (ROOT / 'supabase/sandbox-image-publication-fresh-apply.sql').read_text()
def approved(text):
    return text.replace("namespace_reference text := '';", "namespace_reference text := 'LOCAL FIXTURE ONLY: never used namespace; no prior capabilities';").replace("operator_name text := '';", "operator_name text := 'local fixture';")

ok("alter table storage.buckets add column created_at timestamptz not null default now();")
ok(f"insert into storage.buckets(id,public,file_size_limit,allowed_mime_types) values ('{bucket}',false,2250000,array['image/png','image/jpeg','image/webp','image/gif']);")
denied(apply, 'BLOCKED')
# Unknown permissive policies invalidate initial closed-admissions assumptions.
denied(approved(apply), 'original eight')
ok('drop policy unrelated_broad_policy on storage.objects;')
ok(f"insert into storage.objects(bucket_id,name) values ('{bucket}','dirty');")
denied(approved(apply), 'not empty')
ok(f"delete from storage.objects where bucket_id='{bucket}';")
seed_publication = f"insert into public.capture_image_publications(user_id,image_id,candidate_id,sha256,content_type,byte_size) values ('{A}','dirty','{uuid.uuid4()}','{'a'*64}','image/png',8);"
denied(approved(apply).replace('-- All admissions remain closed', seed_publication + '\n-- All admissions remain closed'), 'not empty')
denied(approved(apply).replace("select true,'fresh',b.id", "select true,'legacy-cutover',b.id"), 'check constraint')
ok(approved(apply))
ok((ROOT / 'supabase/verify-image-publication-fresh.sql').read_text())
denied(approved(apply), 'already installed')
assert ok(user('select public.capture_image_publication_ready();')) == 't'
assert ok(user("select public.capture_image_publication_config()->>'mode';")) == 'fresh'

# Exercise the backup-read migration as an upgrade of an already-attested fresh
# publication schema whose quota constraints predate backup_read.
old_trigger = ok("select oid from pg_trigger where tgrelid='public.capture_image_fresh_activation'::regclass and tgname='capture_image_fresh_fixed';")
old_policies = ok("select string_agg(oid::text,',' order by oid) from pg_policy where (polrelid='storage.objects'::regclass and polname='capture_fresh_tenant') or (polrelid='public.capture_image_publications'::regclass and polname in ('capture_image_publication_owner_select','capture_image_publication_owner_insert')); ")
ok((ROOT / 'supabase/migrations/20260921200000_cloud_owner_quotas.sql').read_text())
ok("delete from public.capture_cloud_quota_policies where scope='backup_read'; alter table public.capture_cloud_owner_quotas drop constraint capture_cloud_owner_quotas_scope_check; alter table public.capture_cloud_owner_quotas add constraint capture_cloud_owner_quotas_scope_check check (scope in ('managed_ai','board_read','board_write')); alter table public.capture_cloud_quota_policies drop constraint capture_cloud_quota_policies_scope_check; alter table public.capture_cloud_quota_policies add constraint capture_cloud_quota_policies_scope_check check (scope in ('managed_ai','board_read','board_write'));")
backup_reads = (ROOT / 'supabase/migrations/20260921210000_cloud_backup_reads.sql').read_text()
ok(backup_reads)
assert ok("select request_limit || ':' || window_seconds from public.capture_cloud_quota_policies where scope='backup_read';") == '2000:3600'
assert ok(user('select public.capture_image_publication_ready();')) == 't'
assert ok("select policy_fingerprint=public.capture_image_fresh_policy_fingerprint() from public.capture_image_fresh_activation where singleton;") == 't'
assert ok("select oid from pg_trigger where tgrelid='public.capture_image_fresh_activation'::regclass and tgname='capture_image_fresh_fixed';") != old_trigger
assert ok("select string_agg(oid::text,',' order by oid) from pg_policy where (polrelid='storage.objects'::regclass and polname='capture_fresh_tenant') or (polrelid='public.capture_image_publications'::regclass and polname in ('capture_image_publication_owner_select','capture_image_publication_owner_insert')); ") != old_policies
assert ok("select count(*) from pg_policy where polrelid='public.capture_image_publications'::regclass and polname in ('capture_image_publication_owner_select','capture_image_publication_owner_insert');") == '2'
# Policy drift must close readiness; replaying the reviewed migration replaces
# the policy, re-attests the fingerprint and restores the immutable trigger.
ok("drop policy capture_image_publication_owner_select on public.capture_image_publications; create policy capture_image_publication_owner_select on public.capture_image_publications for select to authenticated using (false);")
assert ok(user('select public.capture_image_publication_ready();')) == 'f'
assert ok(user('select public.capture_image_publication_config() is null;')) == 't'
ok(backup_reads)
assert ok(user('select public.capture_image_publication_ready();')) == 't'
assert ok("select policy_fingerprint=public.capture_image_fresh_policy_fingerprint() from public.capture_image_fresh_activation where singleton;") == 't'

denied("update public.capture_image_fresh_activation set bucket_id='capture-images';", 'immutable')
denied("update public.capture_image_fresh_activation set mode='legacy-cutover';", 'immutable')
denied('delete from public.capture_image_fresh_activation;', 'immutable')
denied(user('update public.capture_image_fresh_activation set activated_at=null;'), 'permission denied')

def insert(image, candidate, owner=A):
    return f"insert into public.capture_image_publications(user_id,image_id,candidate_id,sha256,content_type,byte_size) values ('{owner}','{image}','{candidate}','{'a'*64}','image/png',8) returning candidate_id;"

# Fresh ignores old logical IDs, including a late old completion racing publication.
for i in range(5):
    image = 'legacy' if i == 0 else f'race-{i}'
    candidates = [str(uuid.uuid4()), str(uuid.uuid4())]
    for c in candidates:
        ok(user(f"insert into storage.objects(bucket_id,name) values ('{bucket}','{A}/{c}');"))
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        writes = [pool.submit(sql, user(insert(image, c))) for c in candidates]
        old = pool.submit(sql, f"insert into storage.objects(bucket_id,name,version) values ('capture-images','{A}/{image}','late') on conflict(bucket_id,name) do update set version='late';")
        results = [r.result() for r in writes]
        assert old.result().returncode == 0
    assert sum(r.returncode == 0 for r in results) == 1
    winner = candidates[next(j for j,r in enumerate(results) if r.returncode == 0)]
    assert ok(user(f"select candidate_id from public.capture_image_publications where image_id='{image}';")) == winner
assert ok(user('select public.capture_image_publication_ready();')) == 't', 'emptiness must not remain a readiness condition'
assert ok(user('select count(*) from public.capture_image_publications;')) == '5'
assert ok(user('select count(*) from public.capture_image_publications;', B)) == '0'
denied("set role anon; select count(*) from public.capture_image_publications;", 'permission denied')
denied(user(insert('cross', str(uuid.uuid4()), B)), 'row-level security')
denied(user(f"insert into storage.objects(bucket_id,name) values ('{bucket}','{B}/{uuid.uuid4()}');"), 'row-level security')
denied(user('delete from public.capture_image_publications;'), 'permission denied')
for op in ['object.list', 'object.sign', 'object.copy']:
    assert ok(user(f"select count(*) from storage.objects where bucket_id='{bucket}';", operation=op)) == '0'
denied(user(f"insert into storage.objects(bucket_id,name) values ('{bucket}','{A}/{uuid.uuid4()}');", operation='object.upload_signed'), 'row-level security')
ok(f"update public.capture_cloud_subscriptions set is_entitled=false where user_id='{A}';")
denied(user(insert('unpaid', str(uuid.uuid4()))), 'row-level security')
denied(user(f"insert into storage.objects(bucket_id,name) values ('{bucket}','{A}/{uuid.uuid4()}');"), 'row-level security')
assert ok(user('select count(*) from public.capture_image_publications;')) == '5'
assert ok(user('select count(*) from public.capture_image_publications;', B)) == '0'
denied("set role anon; select count(*) from public.capture_image_publications;", 'permission denied')
assert ok(user(f"select count(*) from storage.objects where bucket_id='{bucket}';", operation='object.get_authenticated')) == '10'
assert ok(user(f"select count(*) from storage.objects where bucket_id='{bucket}';", B, 'object.get_authenticated')) == '0'
assert ok(f"set role anon; set test.operation='object.get_authenticated'; select count(*) from storage.objects where bucket_id='{bucket}';") == '0'

# Upgrade an active fresh installation without changing its activation identity or
# publication winner behavior. Existing winners seed durable quota usage.
ok("""create table public.capture_boards(user_id uuid primary key);
create table public.capture_external_work_admissions(
  admission_id uuid primary key,owner_id uuid not null,kind text not null,
  lease_expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp(),
  constraint capture_external_work_admissions_kind_check check(kind in ('managed_ai','polar_checkout','polar_portal','polar_reconcile')));
create table public.capture_external_capabilities(capability_id uuid primary key,owner_id uuid not null,kind text,expires_at timestamptz);
create function public.capture_account_owner_lock(p_user_id uuid) returns void language sql security definer set search_path='' as $$
  select pg_advisory_xact_lock(hashtextextended(p_user_id::text,912221)) $$;
create function public.capture_account_write_allowed(p_user_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
  begin perform public.capture_account_owner_lock(p_user_id); return true; end $$;
create function public.capture_account_deleting(p_user_id uuid) returns boolean language sql security definer set search_path='' as $$ select false $$;
""")
ok((ROOT / 'supabase/migrations/20260922200000_image_storage_admissions.sql').read_text())
verifier = (ROOT / 'supabase/verify-image-storage-admissions.sql').read_text()
ok(verifier)
assert ok(user('select public.capture_image_publication_ready();')) == 't'
assert ok(user('select public.capture_image_admission_ready();')) == 't'
assert ok("select policy_fingerprint=public.capture_image_fresh_policy_fingerprint() from public.capture_image_fresh_activation where singleton;") == 't'
assert ok("select admission_fingerprint=public.capture_image_admission_contract_fingerprint() from public.capture_image_storage_policy where singleton;") == 't'

def reattest_admission():
    ok("""drop trigger if exists capture_image_fresh_fixed on public.capture_image_fresh_activation;
      update public.capture_image_storage_policy set
        admission_fingerprint=public.capture_image_admission_contract_fingerprint() where singleton;
      update public.capture_image_fresh_activation set
        policy_fingerprint=public.capture_image_fresh_policy_fingerprint() where singleton;
      create trigger capture_image_fresh_fixed before insert or update or delete
        on public.capture_image_fresh_activation for each row
        execute function public.capture_image_fresh_fixed_fn();""")

# The fresh activation hash now includes the exact direct-upload policy and
# publication-admission trigger body/definition/enabled state. Drift closes both
# gates. Even an explicit hash update cannot bless the wrong command/role/check;
# restoring exact DDL still stays closed until the reviewed rows are re-attested.
ok("alter table public.capture_image_publications disable trigger capture_image_publication_admission_guard;")
assert ok(user('select public.capture_image_publication_ready();')) == 'f'
assert ok(user('select public.capture_image_admission_ready();')) == 'f'
denied(verifier, 'Image admission readiness failed')
ok("alter table public.capture_image_publications enable trigger capture_image_publication_admission_guard;")
assert ok(user('select public.capture_image_publication_ready();')) == 't'
trigger_function = ok("select pg_get_functiondef('public.capture_image_publication_admission_guard_fn()'::regprocedure);")
ok("""create or replace function public.capture_image_publication_admission_guard_fn() returns trigger
  language plpgsql security definer set search_path='' as $$ begin return new; end $$;""")
reattest_admission()
assert ok(user('select public.capture_image_publication_ready();')) == 't'
assert ok(user('select public.capture_image_admission_ready();')) == 'f', 'wrong trigger body cannot be blessed by both fingerprints'
ok(trigger_function)
assert ok(user('select public.capture_image_publication_ready();')) == 'f'
assert ok(user('select public.capture_image_admission_ready();')) == 'f'
reattest_admission()
assert ok(user('select public.capture_image_publication_ready();')) == 't'
assert ok(user('select public.capture_image_admission_ready();')) == 't'
ok("drop policy capture_image_app_only_insert on storage.objects; create policy capture_image_app_only_insert on storage.objects for insert to authenticated with check (true);")
reattest_admission()
assert ok(user('select public.capture_image_publication_ready();')) == 't'
assert ok(user('select public.capture_image_admission_ready();')) == 'f', 'exact policy check rejects a wrongly re-attested policy'
ok("drop policy capture_image_app_only_insert on storage.objects; create policy capture_image_app_only_insert on storage.objects as restrictive for insert to authenticated with check (bucket_id not in ('capture-images','capture-image-candidates','capture-image-candidates-fresh-20260914'));")
assert ok(user('select public.capture_image_publication_ready();')) == 'f'
assert ok(user('select public.capture_image_admission_ready();')) == 'f'
reattest_admission()
assert ok(user('select public.capture_image_publication_ready();')) == 't'
assert ok(user('select public.capture_image_admission_ready();')) == 't'
ok(verifier)
assert ok(f"select reserved_objects||':'||reserved_bytes from public.capture_image_owner_usage where owner_id='{A}';") == '5:40'
denied(user(f"insert into storage.objects(bucket_id,name) values ('{bucket}','{A}/{uuid.uuid4()}');"), 'row-level security')
denied(user(insert('direct-after-upgrade', str(uuid.uuid4()))), 'permission denied')
ok(f"update public.capture_cloud_subscriptions set is_entitled=true,access_expires_at=now()+interval '1 day' where user_id='{A}';")
import json
reserved = json.loads(ok(f"set role service_role; select public.reserve_capture_image_storage('{A}','service-admitted',repeat('c',64),'image/png',8);").splitlines()[-1])
assert reserved['status'] == 'reserved' and reserved['bucket'] == bucket and reserved['objectPath'].startswith(A + '/')
assert ok(f"set role service_role; select public.release_capture_image_storage_reservation('{A}','{reserved['operationId']}','{reserved['leaseId']}');").splitlines()[-1] == 't'
print('PASS: active fresh upgrade seeds winner usage, preserves fingerprint/readiness, closes direct authenticated Storage/publication INSERT, and admits only service-reserved generated paths')
# Drift fails closed; no legacy dependency. Administrative cleanup remains possible.
ok(f"update storage.buckets set public=true where id='{bucket}';")
assert ok(user('select public.capture_image_publication_ready();')) == 'f'
assert ok(user('select public.capture_image_publication_config() is null;')) == 't'
ok(f"delete from storage.objects where bucket_id='{bucket}';")
ok(f"delete from auth.users where id='{A}';")
assert ok('select count(*) from public.capture_image_publications;') == '0'
print('PASS: fresh pre-upgrade backup-read migration, quota upgrade, policy/trigger replacement and re-attestation, exact-owner unpaid reads, wrong/anonymous denial, entitlement-gated writes, activation/provenance guards, immutable mode/bucket, original bucket untouched, five SQL winner races with late old writes, readiness drift and administrative cleanup DB leg. No hosted evidence.')