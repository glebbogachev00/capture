"""Disposable socket-only PostgreSQL test. Synthetic rows, no app env or remote DB.
Storage backend bytes are NOT emulated here; this exercises real SQL/RLS/fences.
"""
import concurrent.futures
import pathlib
import subprocess
import tempfile
import uuid
import sys
import runpy

ROOT = pathlib.Path(__file__).resolve().parents[1]
ENV = {"PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "LC_ALL": "C"}
A = '00000000-0000-4000-8000-000000000001'
B = '00000000-0000-4000-8000-000000000002'
MIGRATION = ROOT / 'supabase/migrations/20260913220000_image_publication.sql'
with tempfile.TemporaryDirectory(prefix='capture-images-pg-', dir='/tmp') as d:
    def command(*args):
        return subprocess.run(args, env=ENV, check=True, capture_output=True, text=True)
    command('initdb', '-D', d+'/data', '-U', 'postgres', '--auth=trust', '--no-locale')
    started = False
    try:
        command('pg_ctl', '-D', d+'/data', '-l', d+'/postgres.log', '-o', f"-k {d} -p 55438 -c listen_addresses=''", '-w', 'start')
        started = True
        args = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', d, '-p', '55438', '-U', 'postgres', '-d', 'postgres']
        def sql(text):
            return subprocess.run(args + ['-c', text], env=ENV, capture_output=True, text=True)
        def ok(text):
            r = sql(text)
            assert r.returncode == 0, r.stderr
            return r.stdout.strip()
        def denied(text, reason=None):
            r = sql(text)
            assert r.returncode != 0, text
            if reason:
                assert reason in r.stderr, r.stderr
        def user(text, owner=A, operation='object.upload'):
            return f"set role authenticated; set request.jwt.claim.sub = '{owner}'; set test.operation = '{operation}'; " + text
        ok(f"""create role anon; create role authenticated; create role service_role;
        create schema auth; create table auth.users(id uuid primary key);
        insert into auth.users values ('{A}'),('{B}');
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
        grant usage on schema auth to authenticated;
        create table public.capture_cloud_subscriptions(user_id uuid, is_entitled boolean, access_expires_at timestamptz);
        insert into public.capture_cloud_subscriptions values ('{A}',true,now()+interval '1 day'),('{B}',true,now()+interval '1 day');
        grant select on public.capture_cloud_subscriptions to authenticated;
        create schema storage;
        create table storage.buckets(id text primary key, public boolean, file_size_limit bigint, allowed_mime_types text[]);
        insert into storage.buckets values ('capture-images',false,2250000,array['image/png','image/jpeg','image/webp','image/gif']),('capture-image-candidates',false,2250000,array['image/png','image/jpeg','image/webp','image/gif']);
        create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text, version text, primary key(bucket_id,name));
        insert into storage.objects(bucket_id,name,version) values ('capture-images','{A}/legacy','original');
        alter table storage.objects enable row level security;
        grant usage on schema storage to authenticated, anon;
        grant all on storage.objects to authenticated, anon;
        create policy unrelated_broad_policy on storage.objects for all to authenticated, anon using(true) with check(true);
        create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
        create function storage.filename(text) returns text language sql immutable as $$ select split_part($1,'/',array_length(string_to_array($1,'/'),1)) $$;
        create function storage.allow_any_operation(text[]) returns boolean language sql stable as $$ select current_setting('test.operation',true)=any($1) $$;
        create function storage.allow_only_operation(text) returns boolean language sql stable as $$ select current_setting('test.operation',true)=$1 $$;
        """)
        ok((ROOT / 'supabase/migrations/20260913120000_capture_images.sql').read_text())
        if '--fresh' in sys.argv:
            runpy.run_path(str(ROOT / 'scripts/test-image-publication-fresh-sql.py'), init_globals=globals())
            raise SystemExit(0)
        ok(MIGRATION.read_text())
        # No unsupported managed-table triggers. Stage 1 does NOT claim a drain.
        assert ok("select count(*) from pg_trigger where tgrelid='storage.objects'::regclass and not tgisinternal;") == '0'
        assert ok(user('select public.capture_image_publication_ready();')) == 'f'
        denied(user("update public.capture_image_cutover set activated_at=now();"), 'permission denied')
        # Old route and direct Storage admissions share this restrictive RLS.
        denied(user(f"insert into storage.objects(bucket_id,name) values ('capture-images','{A}/late');"), 'row-level security')
        # Model an already-admitted provider completion, ordered explicitly after
        # stage 1. It CAN finish. Gate must stay closed, never infer drain by sleep.
        ok(f"insert into storage.objects(bucket_id,name,version) values ('capture-images','{A}/late','stale');")
        assert ok(user('select public.capture_image_publication_ready();')) == 'f'
        denied(user(f"insert into storage.objects(bucket_id,name) values ('capture-image-candidates','{A}/{uuid.uuid4()}');"), 'row-level security')
        denied(user(f"insert into public.capture_image_publications(user_id,image_id,candidate_id,sha256,content_type,byte_size) values ('{A}','blocked','{uuid.uuid4()}','{'a'*64}','image/png',8);"), 'cutover not verified')
        activation_path = ROOT / 'supabase/sandbox-image-publication-stage2.sql'
        assert activation_path.exists(), 'missing default-blocked operator activation procedure'
        activation = activation_path.read_text()
        denied(activation, 'BLOCKED: verified provider drain')
        # Synthetic evidence ONLY in this disposable metadata fixture. This is
        # not a hosted drain, and these values must never become deploy defaults.
        ok(activation.replace("drain_reference text := '';", "drain_reference text := 'LOCAL FIXTURE ONLY: completion explicitly joined';")
            .replace("legacy_reference text := '';", "legacy_reference text := 'LOCAL FIXTURE ONLY: synthetic rows retained';")
            .replace("operator_name text := '';", "operator_name text := 'local SQL test';"))
        ok((ROOT / 'supabase/verify-image-publication.sql').read_text())
        ok((ROOT / 'supabase/migrations/20260921200000_cloud_owner_quotas.sql').read_text())
        ok("delete from public.capture_cloud_quota_policies where scope='backup_read'; alter table public.capture_cloud_owner_quotas drop constraint capture_cloud_owner_quotas_scope_check; alter table public.capture_cloud_owner_quotas add constraint capture_cloud_owner_quotas_scope_check check (scope in ('managed_ai','board_read','board_write')); alter table public.capture_cloud_quota_policies drop constraint capture_cloud_quota_policies_scope_check; alter table public.capture_cloud_quota_policies add constraint capture_cloud_quota_policies_scope_check check (scope in ('managed_ai','board_read','board_write'));")
        ok((ROOT / 'supabase/migrations/20260921210000_cloud_backup_reads.sql').read_text())
        assert ok("select request_limit || ':' || window_seconds from public.capture_cloud_quota_policies where scope='backup_read';") == '2000:3600'
        assert ok(user('select public.capture_image_publication_ready();')) == 't'
        assert ok("select version from storage.objects where name like '%/legacy';") == 'original'
        assert ok(user("select count(*) from storage.objects where bucket_id='capture-images';", operation='object.get_authenticated')) == '2'
        assert ok(user("select count(*) from storage.objects where bucket_id='capture-images';", B, 'object.get_authenticated')) == '0'
        for text in [
            f"insert into storage.objects(bucket_id,name,version) values ('capture-images','{A}/legacy','bad') on conflict(bucket_id,name) do update set version=excluded.version;",
            "update storage.objects set version='bad' where bucket_id='capture-images';",
            "delete from storage.objects where bucket_id='capture-images';",
        ]:
            # User UPDATE/DELETE affect zero rows; upsert is denied on INSERT.
            if text.startswith('insert'):
                denied(user(text), 'row-level security')
            else:
                ok(user(text))
        assert ok("select count(*) from storage.objects where bucket_id='capture-images';") == '2'
        candidate = str(uuid.uuid4())
        ok(user(f"insert into storage.objects(bucket_id,name,version) values ('capture-image-candidates','{A}/{candidate}','original');"))
        assert ok(user("select count(*) from storage.objects where bucket_id='capture-image-candidates';", operation='object.get_authenticated')) == '1'
        assert ok(user("select count(*) from storage.objects where bucket_id='capture-image-candidates';", B, 'object.get_authenticated')) == '0'
        assert ok("set role anon; set test.operation='object.get_authenticated'; select count(*) from storage.objects where bucket_id in ('capture-images','capture-image-candidates');") == '0'
        ok(user("update storage.objects set version='bad' where bucket_id='capture-image-candidates';"))
        assert ok("select version from storage.objects where bucket_id='capture-image-candidates';") == 'original'
        denied(user(f"insert into storage.objects(bucket_id,name) values ('capture-image-candidates','{B}/{uuid.uuid4()}');"), 'row-level security')
        denied(user(f"insert into storage.objects(bucket_id,name) values ('capture-image-candidates','{A}/not-uuid');"), 'row-level security')
        def insert(image, candidate_id, owner=A):
            return f"insert into public.capture_image_publications(user_id,image_id,candidate_id,sha256,content_type,byte_size) values ('{owner}','{image}','{candidate_id}','{'a'*64}','image/png',8) returning candidate_id;"
        denied(user(insert('legacy', candidate)), 'legacy image already exists')
        denied(user(insert('late', candidate)), 'legacy image already exists')
        for i in range(5):
            candidates = [str(uuid.uuid4()), str(uuid.uuid4())]
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda c: sql(user(insert(f'race-{i}', c))), candidates))
            assert sum(r.returncode == 0 for r in results) == 1
            winner = candidates[next(j for j,r in enumerate(results) if r.returncode == 0)]
            assert ok(user(f"select candidate_id from public.capture_image_publications where image_id='race-{i}';")) == winner
        assert ok(user('select count(*) from public.capture_image_publications;', B)) == '0'
        denied(user(insert('cross-owner', str(uuid.uuid4()), B)), 'row-level security')
        for change in ['update public.capture_image_publications set sha256=repeat(\'b\',64);', 'delete from public.capture_image_publications;']:
            denied(user(change), 'permission denied')
        for op in ['object.sign', 'object.list', 'object.copy']:
            assert ok(user("select count(*) from storage.objects where bucket_id='capture-image-candidates';", operation=op)) == '0'
        denied(user(f"insert into storage.objects(bucket_id,name) values ('capture-image-candidates','{A}/{uuid.uuid4()}');", operation='object.upload_signed'), 'row-level security')
        ok(f"update public.capture_cloud_subscriptions set is_entitled=false where user_id='{A}';")
        assert ok(user('select count(*) from public.capture_image_publications;')) == '5'
        denied(user(insert('revoked', str(uuid.uuid4()))), 'row-level security')
        denied(user(f"insert into storage.objects(bucket_id,name) values ('capture-image-candidates','{A}/{uuid.uuid4()}');"), 'row-level security')
        assert ok(user("select count(*) from storage.objects where bucket_id='capture-image-candidates';", operation='object.get_authenticated')) == '1'
        assert ok(user("select count(*) from storage.objects where bucket_id='capture-images';", operation='object.get_authenticated')) == '2'
        # Upgrade an active legacy-cutover installation. Existing publications are
        # seeded into the new ledger before direct authenticated admissions close.
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
        assert ok("select count(*) from public.capture_image_storage_policy;") == '1'
        assert ok("select max_objects||':'||max_bytes||':'||max_object_bytes||':'||lease_seconds||':'||stale_reclaim_enabled::text from public.capture_image_storage_policy;") == '256:576000000:2250000:120:false'
        assert ok("select admission_fingerprint=public.capture_image_admission_contract_fingerprint() from public.capture_image_storage_policy;") == 't'

        # Executable catalog drift: enabled state, trigger function body, exact
        # policy command/role/USING/WITH CHECK, singleton defaults and ACL all
        # close admission. Restoring exact DDL plus explicit fingerprint
        # re-attestation reopens it; verifier execution—not source matching—is
        # the acceptance signal.
        ok("alter table public.capture_image_publications disable trigger capture_image_publication_admission_guard;")
        assert ok(user('select public.capture_image_admission_ready();')) == 'f'
        denied(verifier, 'Image admission readiness failed')
        ok("alter table public.capture_image_publications enable trigger capture_image_publication_admission_guard;")
        assert ok(user('select public.capture_image_admission_ready();')) == 't'
        trigger_function = ok("select pg_get_functiondef('public.capture_image_publication_admission_guard_fn()'::regprocedure);")
        ok("""create or replace function public.capture_image_publication_admission_guard_fn() returns trigger
          language plpgsql security definer set search_path='' as $$ begin return new; end $$;""")
        ok("update public.capture_image_storage_policy set admission_fingerprint=public.capture_image_admission_contract_fingerprint() where singleton;")
        assert ok(user('select public.capture_image_admission_ready();')) == 'f', 'wrong trigger body cannot be blessed by fingerprint alone'
        ok(trigger_function)
        assert ok(user('select public.capture_image_admission_ready();')) == 'f', 'restored trigger body still needs explicit re-attestation'
        ok("update public.capture_image_storage_policy set admission_fingerprint=public.capture_image_admission_contract_fingerprint() where singleton;")
        assert ok(user('select public.capture_image_admission_ready();')) == 't'
        ok("drop policy capture_image_app_only_insert on storage.objects; create policy capture_image_app_only_insert on storage.objects for insert to authenticated with check (true);")
        ok("update public.capture_image_storage_policy set admission_fingerprint=public.capture_image_admission_contract_fingerprint() where singleton;")
        assert ok(user('select public.capture_image_admission_ready();')) == 'f', 'bad policy cannot be blessed by fingerprint alone'
        ok("drop policy capture_image_app_only_insert on storage.objects; create policy capture_image_app_only_insert on storage.objects as restrictive for insert to authenticated with check (bucket_id not in ('capture-images','capture-image-candidates','capture-image-candidates-fresh-20260914'));")
        assert ok(user('select public.capture_image_admission_ready();')) == 'f', 'restored DDL still needs explicit re-attestation'
        ok("update public.capture_image_storage_policy set admission_fingerprint=public.capture_image_admission_contract_fingerprint() where singleton;")
        assert ok(user('select public.capture_image_admission_ready();')) == 't'
        ok("grant insert on public.capture_image_storage_policy to service_role;")
        assert ok(user('select public.capture_image_admission_ready();')) == 'f'
        ok("revoke insert on public.capture_image_storage_policy from service_role;")
        assert ok(user('select public.capture_image_admission_ready();')) == 't'
        ok("update public.capture_image_storage_policy set max_objects=257 where singleton;")
        assert ok(user('select public.capture_image_admission_ready();')) == 'f'
        ok("update public.capture_image_storage_policy set max_objects=256 where singleton;")
        assert ok(user('select public.capture_image_admission_ready();')) == 't'
        ok("delete from public.capture_image_storage_policy;")
        assert ok(user('select public.capture_image_admission_ready();')) == 'f'
        ok("insert into public.capture_image_storage_policy(singleton,max_objects,max_bytes,max_object_bytes,lease_seconds,stale_reclaim_enabled,admission_fingerprint) values(true,256,576000000,2250000,120,false,public.capture_image_admission_contract_fingerprint());")
        assert ok(user('select public.capture_image_admission_ready();')) == 't'
        ok(verifier)
        assert ok(f"select reserved_objects||':'||reserved_bytes from public.capture_image_owner_usage where owner_id='{A}';") == '5:40'
        denied(user(f"insert into storage.objects(bucket_id,name) values ('capture-image-candidates','{A}/{uuid.uuid4()}');"), 'row-level security')
        denied(user(insert('direct-after-upgrade', str(uuid.uuid4()))), 'permission denied')
        ok(f"update public.capture_cloud_subscriptions set is_entitled=true,access_expires_at=now()+interval '1 day' where user_id='{A}';")
        reservation = ok(f"set role service_role; select public.reserve_capture_image_storage('{A}','service-admitted',repeat('c',64),'image/png',8);")
        import json
        reserved = json.loads(reservation.splitlines()[-1])
        assert reserved['status'] == 'reserved' and reserved['objectPath'].startswith(A + '/')
        assert ok(f"set role service_role; select public.release_capture_image_storage_reservation('{A}','{reserved['operationId']}','{reserved['leaseId']}');").splitlines()[-1] == 't'
        print('PASS: active legacy-cutover upgrade seeds winner usage, preserves readiness, closes direct authenticated Storage/publication INSERT, and admits only service-reserved generated paths')
        # Administrative backend DML models the DB leg of Storage API deletion,
        # NOT a supported instruction to delete hosted metadata with SQL.
        ok(f"delete from storage.objects where name like '{A}/%';")
        assert ok("select count(*) from storage.objects;") == '0'
        ok(f"delete from auth.users where id='{A}';")
        assert ok('select count(*) from public.capture_image_publications;') == '0'
        ok('update public.capture_image_cutover set activated_at=null;')
        assert ok(user('select public.capture_image_publication_ready();')) == 'f'
        print('PASS: real PostgreSQL publication races, stale admissions denied, pre-admitted completion explicitly NOT fenced and activation stays closed, legacy collision denial, tenant/paid/operation RLS, admin cleanup DB leg and FK cascade, closed activation gate. No hosted drain/API/bytes proof.')
    finally:
        if started:
            command('pg_ctl', '-D', d+'/data', '-m', 'immediate', '-w', 'stop')
