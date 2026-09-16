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
assert ok(user('select count(*) from public.capture_image_publications;', B)) == '0'
denied(user(insert('cross', str(uuid.uuid4()), B)), 'row-level security')
denied(user(f"insert into storage.objects(bucket_id,name) values ('{bucket}','{B}/{uuid.uuid4()}');"), 'row-level security')
denied(user('delete from public.capture_image_publications;'), 'permission denied')
for op in ['object.list', 'object.sign', 'object.copy']:
    assert ok(user(f"select count(*) from storage.objects where bucket_id='{bucket}';", operation=op)) == '0'
denied(user(f"insert into storage.objects(bucket_id,name) values ('{bucket}','{A}/{uuid.uuid4()}');", operation='object.upload_signed'), 'row-level security')
ok(f"update public.capture_cloud_subscriptions set is_entitled=false where user_id='{A}';")
denied(user(insert('unpaid', str(uuid.uuid4()))), 'row-level security')
denied(user(f"insert into storage.objects(bucket_id,name) values ('{bucket}','{A}/{uuid.uuid4()}');"), 'row-level security')
assert ok(user('select count(*) from public.capture_image_publications;')) == '0'
# Drift fails closed; no legacy dependency. Administrative cleanup remains possible.
ok(f"update storage.buckets set public=true where id='{bucket}';")
assert ok(user('select public.capture_image_publication_ready();')) == 'f'
assert ok(user('select public.capture_image_publication_config() is null;')) == 't'
ok(f"delete from storage.objects where bucket_id='{bucket}';")
ok(f"delete from auth.users where id='{A}';")
assert ok('select count(*) from public.capture_image_publications;') == '0'
print('PASS: fresh activation/provenance guards, immutable mode/bucket, original bucket untouched, five SQL winner races with late old writes, paid/tenant/operation RLS, readiness drift and administrative cleanup DB leg. No hosted evidence.')