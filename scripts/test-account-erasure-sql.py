"""Exercise account-erasure SQL in a disposable local PostgreSQL database.
Usage: python3 scripts/test-account-erasure-sql.py /absolute/socket/directory 55441
Never reads application environment variables or opens a TCP connection.
"""
import json
import pathlib
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

socket = pathlib.Path(sys.argv[1])
port = sys.argv[2]
if not socket.is_absolute() or not (socket / f".s.PGSQL.{port}").is_socket():
    raise SystemExit("An existing absolute local PostgreSQL socket directory is required")
root = pathlib.Path(__file__).resolve().parents[1]
database = "capture_erasure_test_" + uuid.uuid4().hex
base = ["psql", "-X", "-h", str(socket), "-p", port, "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At"]
env = {"PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "LC_ALL": "C"}


def sql(query, db=database, ok=True):
    result = subprocess.run(base + ["-d", db], input=query, text=True, capture_output=True, env=env)
    if ok and result.returncode:
        raise AssertionError(result.stderr)
    if not ok:
        assert result.returncode, "Expected database rejection"
        return result.stderr.lower()
    return result.stdout.strip()


owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
third = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
race_owner = "ffffffff-ffff-4fff-8fff-ffffffffffff"
operation_id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
receipt_hash = "a" * 64
session_hash = "b" * 64

sql(f"create database {database};", db="postgres")
try:
    sql("""
    do $$ begin
      if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select from pg_roles where rolname='service_role') then create role service_role; end if;
    end $$;
    create schema auth;
    create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    grant usage on schema auth, public, storage to anon, authenticated, service_role;

    create table public.capture_boards(
      user_id uuid primary key references auth.users(id) on delete cascade,
      board jsonb not null default '{}'::jsonb, tombstones jsonb not null default '[]'::jsonb,
      rev bigint not null default 1, updated_at timestamptz not null default now()
    );
    alter table public.capture_boards enable row level security;
    grant select,insert,update,delete on public.capture_boards to authenticated;
    create policy capture_boards_select on public.capture_boards for select to authenticated using(auth.uid()=user_id);
    create policy capture_boards_insert on public.capture_boards for insert to authenticated with check(auth.uid()=user_id);
    create policy capture_boards_update on public.capture_boards for update to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
    create policy capture_boards_delete on public.capture_boards for delete to authenticated using(auth.uid()=user_id);


    create table public.capture_image_publications(
      user_id uuid not null references auth.users(id) on delete cascade,
      image_id text not null, candidate_id uuid not null,
      sha256 text not null default repeat('a',64),
      content_type text not null default 'image/png',
      byte_size integer not null default 8,
      primary key(user_id,image_id), unique(user_id,candidate_id)
    );
    alter table public.capture_image_publications enable row level security;
    grant select,insert on public.capture_image_publications to authenticated;
    create policy capture_image_publication_owner_insert on public.capture_image_publications
      for insert to authenticated with check(auth.uid()=user_id);
    create policy capture_image_publication_owner_select on public.capture_image_publications
      for select to authenticated using(auth.uid()=user_id);

    create table storage.objects(bucket_id text not null, name text not null, primary key(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated;
    create policy capture_storage_owner_select on storage.objects for select to authenticated
      using(split_part(name,'/',1)=auth.uid()::text);
    create policy capture_storage_owner_insert on storage.objects for insert to authenticated
      with check(split_part(name,'/',1)=auth.uid()::text);

    create table public.capture_cloud_owner_quotas(
      user_id uuid not null references auth.users(id) on delete cascade,
      scope text not null, window_started_at timestamptz not null,
      request_count integer not null, updated_at timestamptz not null default now(),
      primary key(user_id,scope)
    );
    create table public.capture_cloud_quota_policies(
      scope text primary key, request_limit integer not null, window_seconds integer not null
    );
    insert into public.capture_cloud_quota_policies values('board_write',10,3600);

    """)
    for migration in [
        "20260911170000_polar_entitlements.sql",
        "20260912162000_polar_event_ordering.sql",
        "20260913190000_polar_missing_user.sql",
        "20260913200000_polar_reconciliation.sql",
        "20260913210000_polar_review_guards.sql",
    ]:
        sql((root / "supabase/migrations" / migration).read_text())
    sql((root / "supabase/migrations/20260922100000_account_erasure.sql").read_text())
    polar_signature = (
        "public.apply_polar_subscription_event(text,text,timestamp with time zone,uuid,text,text,"
        "boolean,text,text,text,timestamp with time zone,timestamp with time zone,"
        "timestamp with time zone,boolean)"
    )
    polar_base_signature = polar_signature.replace(
        "apply_polar_subscription_event(", "apply_polar_subscription_event_base(", 1
    )
    assert sql(f"select to_regprocedure('{polar_signature}') is not null;") == "t"
    assert sql(
        f"select has_function_privilege('service_role','{polar_signature}','execute')::text||':'||"
        f"has_function_privilege('authenticated','{polar_signature}','execute')::text||':'||"
        f"has_function_privilege('anon','{polar_signature}','execute')::text;"
    ) == "true:false:false"
    assert sql(
        f"select has_function_privilege('service_role','{polar_base_signature}','execute');"
    ) == "f"
    sql("""
    create function public.capture_image_publication_ready() returns boolean
      language sql stable security definer set search_path='' as 'select true';
    create function public.capture_image_publication_config() returns jsonb
      language sql stable security definer set search_path=''
      as 'select jsonb_build_object(''mode'',''legacy-cutover'',''bucket'',''capture-image-candidates'')';
    create function public.capture_image_cutover_verified() returns boolean
      language sql stable security definer set search_path='' as 'select true';
    grant execute on function public.capture_image_publication_ready() to authenticated;
    grant execute on function public.capture_image_publication_config() to authenticated;
    """)
    sql((root / "supabase/migrations/20260922200000_image_storage_admissions.sql").read_text())

    sql(f"""
      insert into auth.users values('{owner}'),('{other}'),('{third}'),('{race_owner}');
      insert into public.capture_boards(user_id) values('{owner}'),('{other}');
      insert into public.capture_cloud_subscriptions(
        polar_subscription_id,user_id,status,plan,is_entitled,polar_customer_id,polar_product_id,
        current_period_start,current_period_end,access_expires_at,cancel_at_period_end,last_event_at
      ) values('sub_1','{owner}','active','monthly',true,'cus_1','product_1',now(),now()+interval '1 month',now()+interval '1 month',false,now());
      insert into public.capture_image_owner_usage values('{owner}',1,8,clock_timestamp());
      insert into public.capture_image_operations(
        operation_id,owner_id,image_id,candidate_id,bucket_id,sha256,content_type,byte_size,state,lease_id,lease_expires_at
      ) values(
        '10101010-1010-4010-8010-101010101010','{owner}','photo','dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'capture-image-candidates',repeat('a',64),'image/png',8,'uploaded',
        '20202020-2020-4020-8020-202020202020',clock_timestamp()+interval '2 minutes'
      );
      insert into public.capture_external_work_admissions values(
        '10101010-1010-4010-8010-101010101010','{owner}','image_upload',clock_timestamp()+interval '2 minutes',clock_timestamp()
      );
      select set_config('capture.image_operation_id','10101010-1010-4010-8010-101010101010',false);
      insert into public.capture_image_publications(user_id,image_id,candidate_id,sha256,content_type,byte_size)
        values('{owner}','photo','dddddddd-dddd-4ddd-8ddd-dddddddddddd',repeat('a',64),'image/png',8);
      update public.capture_image_operations set state='published',finalized_at=clock_timestamp()
        where operation_id='10101010-1010-4010-8010-101010101010';
      delete from public.capture_external_work_admissions where admission_id='10101010-1010-4010-8010-101010101010';
      insert into storage.objects values('capture-images','{owner}/photo');
      insert into public.capture_cloud_owner_quotas values('{owner}','board_write',now(),1,now());
    """)

    # Service-only image reservations account object and byte capacity atomically.
    # Keep the source launch policy immutable in this acceptance run. A request
    # one byte above the per-object ceiling is denied before any quota mutation.
    def reserve_image(image):
        output = sql(f"set role service_role; select public.reserve_capture_image_storage('{owner}','{image}',repeat('b',64),'image/png',100);")
        return json.loads(output.splitlines()[-1])
    assert "image reservation policy unavailable" in sql(
        f"set role service_role; select public.reserve_capture_image_storage('{owner}','over-byte-limit',repeat('b',64),'image/png',2250001);",
        ok=False,
    )
    assert sql(f"select reserved_objects||':'||reserved_bytes from public.capture_image_owner_usage where owner_id='{owner}';") == "1:8"
    # Fill to 253 exact durable objects without weakening the singleton policy;
    # the concurrent RPC race can then admit exactly three and deny two by the
    # real 256-object default.
    sql(f"""insert into public.capture_image_operations(
      owner_id,image_id,bucket_id,sha256,content_type,byte_size,state,lease_expires_at,finalized_at)
      select '{owner}','quota-seed-'||series,'capture-image-candidates',repeat('d',64),
        'image/png',100,'abandoned',clock_timestamp()+interval '1 day',clock_timestamp()
      from generate_series(1,252) series;
      update public.capture_image_owner_usage usage set
        reserved_objects=aggregate.objects,reserved_bytes=aggregate.bytes,updated_at=clock_timestamp()
      from (select count(*)::integer objects,sum(byte_size)::bigint bytes
        from public.capture_image_operations where owner_id='{owner}'
          and state not in ('released','deleted')) aggregate
      where usage.owner_id='{owner}';""")
    with ThreadPoolExecutor(max_workers=5) as pool:
        reservations = list(pool.map(lambda _index: reserve_image('reservation-race'), range(5)))
    admitted = [value for value in reservations if value["status"] == "reserved"]
    denied_quota = [value for value in reservations if value["status"] == "quota_exceeded"]
    assert len(admitted) == 3 and len(denied_quota) == 2
    assert sql(f"select reserved_objects||':'||reserved_bytes from public.capture_image_owner_usage where owner_id='{owner}';") == "256:25508"
    assert "permission denied" in sql(
        f"set role authenticated; set request.jwt.claim.sub='{owner}'; select public.reserve_capture_image_storage('{owner}','direct',repeat('b',64),'image/png',100);",
        ok=False,
    )
    assert "row-level security" in sql(
        f"set role authenticated; set request.jwt.claim.sub='{owner}'; insert into storage.objects values('capture-image-candidates','{owner}/{uuid.uuid4()}');",
        ok=False,
    )
    assert "permission denied" in sql(
        f"set role authenticated; set request.jwt.claim.sub='{owner}'; insert into public.capture_image_publications(user_id,image_id,candidate_id) values('{owner}','direct','{uuid.uuid4()}');",
        ok=False,
    )

    # Two independent candidates for one logical ID finalize to one immutable
    # winner. The loser remains durable/accounted; finalize is idempotent.
    for value in admitted[:2]:
        assert sql(f"set role service_role; select public.record_capture_image_storage_upload('{owner}','{value['operationId']}','{value['leaseId']}');").splitlines()[-1] == "t"
    first = json.loads(sql(f"set role service_role; select public.finalize_capture_image_storage('{owner}','{admitted[0]['operationId']}','{admitted[0]['leaseId']}');").splitlines()[-1])
    second = json.loads(sql(f"set role service_role; select public.finalize_capture_image_storage('{owner}','{admitted[1]['operationId']}','{admitted[1]['leaseId']}');").splitlines()[-1])
    replay = json.loads(sql(f"set role service_role; select public.finalize_capture_image_storage('{owner}','{admitted[0]['operationId']}','{admitted[0]['leaseId']}');").splitlines()[-1])
    assert first["status"] == "published" and second["status"] == "abandoned"
    assert first["winner"]["candidateId"] == second["winner"]["candidateId"] == replay["winner"]["candidateId"]
    # A pre-upload reservation can be released repeatedly without underflow.
    releasable = admitted[2]
    release_sql = f"set role service_role; select public.release_capture_image_storage_reservation('{owner}','{releasable['operationId']}','{releasable['leaseId']}');"
    assert sql(release_sql).splitlines()[-1] == "t"
    assert sql(release_sql).splitlines()[-1] == "t"
    assert sql(f"select reserved_objects||':'||reserved_bytes from public.capture_image_owner_usage where owner_id='{owner}';") == "255:25408"

    # Expiry reclaims only the worker admission. Capacity and the candidate path
    # remain inventoried because a provider completion may still land later.
    stale = reserve_image('stale-reservation')
    assert stale["status"] == "reserved"
    abandon_sql = f"set role service_role; select public.abandon_capture_image_storage_reservation('{owner}','{stale['operationId']}','{stale['leaseId']}');"
    assert sql(abandon_sql).splitlines()[-1] == "t"
    assert sql(abandon_sql).splitlines()[-1] == "t"
    assert sql(f"select count(*) from public.capture_external_work_admissions where admission_id='{stale['operationId']}';") == "1"
    sql(f"update public.capture_image_operations set lease_expires_at=clock_timestamp()-interval '1 second' where operation_id='{stale['operationId']}';")
    assert reserve_image('over-limit-after-stale')["status"] == "quota_exceeded"
    assert sql(f"select state from public.capture_image_operations where operation_id='{stale['operationId']}';") == "abandoned"
    reconcile_lease = str(uuid.uuid4())
    claimed = json.loads(sql(f"set role service_role; select public.claim_capture_image_reconciliation('{reconcile_lease}');").splitlines()[-1])
    assert claimed["operationId"] == stale["operationId"]
    assert claimed["claimedState"] == "abandoned" and isinstance(claimed["operationVersion"], int)
    assert "provider inventory and quiescence are not attested" in sql(
        f"set role service_role; select public.reconcile_capture_image_operation('{stale['operationId']}','{reconcile_lease}',{claimed['operationVersion']},'{claimed['claimedState']}',true);",
        ok=False,
    )
    # Account-erasure's exact-path provider readback authorizes this service-only
    # ledger transition; the source worker remains hard-stopped until hosted
    # inventory/quiescence can make that readback authoritative.
    assert sql(f"set role service_role; select public.mark_capture_image_operation_deleted('{owner}','{stale['operationId']}');").splitlines()[-1] == "t"
    assert sql(f"select public.capture_image_inventory_remaining('{owner}');") == "t"

    def assert_usage_matches_operations(expected="255:25408"):
        usage = sql(f"select reserved_objects||':'||reserved_bytes from public.capture_image_owner_usage where owner_id='{owner}';")
        aggregate = sql(f"select count(*)::text||':'||coalesce(sum(byte_size),0)::text from public.capture_image_operations where owner_id='{owner}' and state not in ('released','deleted');")
        assert usage == aggregate == expected
        assert sql(f"select reserved_objects>=0 and reserved_bytes>=0 from public.capture_image_owner_usage where owner_id='{owner}';") == "t"

    assert_usage_matches_operations()
    sql("update public.capture_image_storage_policy set stale_reclaim_enabled=true where singleton;")

    def claim_expired(candidate, state="reserved"):
        sql(f"update public.capture_image_operations set lease_expires_at=clock_timestamp()-interval '1 second' where operation_id='{candidate['operationId']}';")
        reconciliation_lease = str(uuid.uuid4())
        ticket = json.loads(sql(
            f"set role service_role; select public.claim_capture_image_reconciliation('{reconciliation_lease}');"
        ).splitlines()[-1])
        assert ticket["operationId"] == candidate["operationId"] and ticket["claimedState"] == state
        return reconciliation_lease, ticket

    def stale_completion(candidate, reconciliation_lease, ticket):
        return sql(f"""set role service_role; select public.reconcile_capture_image_operation(
          '{candidate['operationId']}','{reconciliation_lease}',{ticket['operationVersion']},
          '{ticket['claimedState']}',true);""").splitlines()[-1]

    # Every operation transition that can compete with a claimed reconciler
    # invalidates the lease/version. These cases exercise expiry, upload record,
    # abandon, and publication/finalization; release and erasure deletion get
    # deterministic interleavings below.
    expiry_candidate = reserve_image("reconcile-expiry-transition")
    expiry_lease, expiry_ticket = claim_expired(expiry_candidate)
    assert reserve_image("expiry-sweep-denied")["status"] == "quota_exceeded"
    assert stale_completion(expiry_candidate, expiry_lease, expiry_ticket) == "f"
    assert sql(f"select state||':'||(reconciliation_lease_id is null)::text from public.capture_image_operations where operation_id='{expiry_candidate['operationId']}';") == "abandoned:true"
    assert sql(f"set role service_role; select public.mark_capture_image_operation_deleted('{owner}','{expiry_candidate['operationId']}');").splitlines()[-1] == "t"

    record_candidate = reserve_image("reconcile-record-transition")
    record_lease, record_ticket = claim_expired(record_candidate)
    sql(f"update public.capture_image_operations set lease_expires_at=clock_timestamp()+interval '1 minute' where operation_id='{record_candidate['operationId']}';")
    assert sql(f"set role service_role; select public.record_capture_image_storage_upload('{owner}','{record_candidate['operationId']}','{record_candidate['leaseId']}');").splitlines()[-1] == "t"
    assert stale_completion(record_candidate, record_lease, record_ticket) == "f"
    assert sql(f"select state||':'||(reconciliation_lease_id is null)::text from public.capture_image_operations where operation_id='{record_candidate['operationId']}';") == "uploaded:true"
    assert sql(f"set role service_role; select public.mark_capture_image_operation_deleted('{owner}','{record_candidate['operationId']}');").splitlines()[-1] == "t"

    abandon_candidate = reserve_image("reconcile-abandon-transition")
    abandon_lease, abandon_ticket = claim_expired(abandon_candidate)
    assert sql(f"set role service_role; select public.abandon_capture_image_storage_reservation('{owner}','{abandon_candidate['operationId']}','{abandon_candidate['leaseId']}');").splitlines()[-1] == "t"
    assert stale_completion(abandon_candidate, abandon_lease, abandon_ticket) == "f"
    assert sql(f"select state||':'||(reconciliation_lease_id is null)::text from public.capture_image_operations where operation_id='{abandon_candidate['operationId']}';") == "abandoned:true"
    assert sql(f"set role service_role; select public.mark_capture_image_operation_deleted('{owner}','{abandon_candidate['operationId']}');").splitlines()[-1] == "t"

    finalize_candidate = reserve_image("reconcile-finalize-transition")
    assert sql(f"set role service_role; select public.record_capture_image_storage_upload('{owner}','{finalize_candidate['operationId']}','{finalize_candidate['leaseId']}');").splitlines()[-1] == "t"
    finalize_lease, finalize_ticket = claim_expired(finalize_candidate, "uploaded")
    sql(f"update public.capture_image_operations set lease_expires_at=clock_timestamp()+interval '1 minute' where operation_id='{finalize_candidate['operationId']}';")
    finalized = json.loads(sql(f"set role service_role; select public.finalize_capture_image_storage('{owner}','{finalize_candidate['operationId']}','{finalize_candidate['leaseId']}');").splitlines()[-1])
    assert finalized["status"] == "published"
    assert stale_completion(finalize_candidate, finalize_lease, finalize_ticket) == "f"
    assert sql(f"select state||':'||(reconciliation_lease_id is null)::text from public.capture_image_operations where operation_id='{finalize_candidate['operationId']}';") == "published:true"
    assert sql(f"set role service_role; select public.mark_capture_image_operation_deleted('{owner}','{finalize_candidate['operationId']}');").splitlines()[-1] == "t"
    assert_usage_matches_operations()

    def stale_reconcile_loses_to_transition(kind, transition_sql, expected_state, pause_lock):
        candidate = reserve_image(f"reconcile-{kind}-race")
        assert candidate["status"] == "reserved"
        sql(f"update public.capture_image_operations set lease_expires_at=clock_timestamp()-interval '1 second' where operation_id='{candidate['operationId']}';")
        reconciliation_lease = str(uuid.uuid4())
        ticket = json.loads(sql(
            f"set role service_role; select public.claim_capture_image_reconciliation('{reconciliation_lease}');"
        ).splitlines()[-1])
        assert ticket["operationId"] == candidate["operationId"]
        assert ticket["claimedState"] == "reserved"

        blocker = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
        blocker.stdin.write(f"select pg_advisory_lock({pause_lock});\n\\echo RACE_BLOCKER_READY\n")
        blocker.stdin.flush()
        while blocker.stdout.readline().strip() != "RACE_BLOCKER_READY":
            pass

        transition = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
        transition.stdin.write(f"""begin;
set application_name='capture-image-{kind}-transition';
set role service_role;
{transition_sql(candidate)}
\\echo TRANSITION_HELD
select pg_advisory_lock({pause_lock});
commit;
""")
        transition.stdin.flush()
        while transition.stdout.readline().strip() != "TRANSITION_HELD":
            pass

        reconciler = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
        reconciler.stdin.write(f"""set application_name='capture-image-{kind}-reconciler';
set role service_role;
select public.reconcile_capture_image_operation(
  '{candidate['operationId']}','{reconciliation_lease}',{ticket['operationVersion']},
  '{ticket['claimedState']}',true);
""")
        reconciler.stdin.close()
        deadline = time.time() + 5
        while True:
            if reconciler.poll() is not None:
                raise AssertionError(f"stale {kind} reconciler did not wait for the owner transition")
            wait_state = sql(f"select coalesce(wait_event_type,'')||':'||state from pg_stat_activity where application_name='capture-image-{kind}-reconciler';")
            if wait_state.startswith("Lock:"):
                break
            if time.time() > deadline:
                raise AssertionError(f"stale {kind} reconciler did not reach owner lock: {wait_state!r}")
            time.sleep(0.02)

        blocker.stdin.write(f"select pg_advisory_unlock({pause_lock});\n\\q\n")
        blocker.stdin.flush()
        transition.stdin.close()
        transition.wait(timeout=5)
        reconciler.wait(timeout=5)
        blocker.wait(timeout=5)
        assert transition.returncode == 0, transition.stderr.read()
        assert reconciler.returncode == 0, reconciler.stderr.read()
        assert reconciler.stdout.read().splitlines()[-1] == "f"
        assert sql(f"select state||':'||(reconciliation_lease_id is null)::text from public.capture_image_operations where operation_id='{candidate['operationId']}';") == f"{expected_state}:true"
        assert_usage_matches_operations()

    stale_reconcile_loses_to_transition(
        "release",
        lambda candidate: f"select public.release_capture_image_storage_reservation('{owner}','{candidate['operationId']}','{candidate['leaseId']}');",
        "released",
        616161,
    )
    stale_reconcile_loses_to_transition(
        "erasure-delete",
        lambda candidate: f"select public.mark_capture_image_operation_deleted('{owner}','{candidate['operationId']}');",
        "deleted",
        626262,
    )
    sql("update public.capture_image_storage_policy set stale_reclaim_enabled=false where singleton;")
    assert sql("select public.capture_image_admission_ready();") == "t"
    print("PASS: image reservations enforce default object/per-object-byte capacity; stale reconcile loses deterministically to release and erasure deletion without quota underflow")

    # A real board update admitted before any erasure-operation row exists must
    # hold the same owner transaction lock as prepare/confirm. Pause it after
    # the RLS admission predicate has run, prove another owner is independent,
    # and prove this owner's erasure cannot overtake the pending commit.
    write_pause_lock = 515151
    other_operation = "13131313-1313-4313-8313-131313131313"
    other_receipt = "1" * 64
    cross_operation = "14141414-1414-4414-8414-141414141414"
    cross_receipt = "2" * 64
    blocker = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
    blocker.stdin.write(f"select pg_advisory_lock({write_pause_lock});\n\\echo WRITE_PAUSE_READY\n")
    blocker.stdin.flush()
    while blocker.stdout.readline().strip() != "WRITE_PAUSE_READY":
        pass
    writer = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
    writer.stdin.write(f"""begin;
set role authenticated;
set request.jwt.claim.sub='{other}';
update public.capture_boards set rev=2 where user_id='{other}';
\\echo WRITE_ADMITTED
select pg_advisory_lock({write_pause_lock});
commit;
\\echo WRITE_COMMITTED
""")
    writer.stdin.flush()
    while writer.stdout.readline().strip() != "WRITE_ADMITTED":
        pass
    eraser = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
    eraser.stdin.write(f"""set application_name='capture-owner-erasure-race';
set role service_role;
select public.prepare_capture_account_erasure('{other_operation}','{other}','{session_hash}','{other_receipt}',clock_timestamp()+interval '30 minutes');
\\echo OWNER_PREPARED
select public.confirm_capture_account_erasure('{other_operation}','{other}','{session_hash}','{other_receipt}');
\\echo OWNER_CONFIRMED
""")
    eraser.stdin.close()

    cross = json.loads(sql(f"""set role service_role;
      select public.prepare_capture_account_erasure('{cross_operation}','{race_owner}','{session_hash}','{cross_receipt}',clock_timestamp()+interval '30 minutes');
      select public.confirm_capture_account_erasure('{cross_operation}','{race_owner}','{session_hash}','{cross_receipt}');""").splitlines()[-1])
    cross_replay = json.loads(sql(f"""set role service_role;
      select public.confirm_capture_account_erasure('{cross_operation}','{race_owner}','{session_hash}','{cross_receipt}');""").splitlines()[-1])
    assert cross["stage"] == "polar" and cross_replay["version"] == cross["version"]

    deadline = time.time() + 5
    while True:
        if eraser.poll() is not None:
            raise AssertionError("owner erasure overtook a board write admitted before prepare")
        wait_state = sql("select coalesce(wait_event_type,'')||':'||state from pg_stat_activity where application_name='capture-owner-erasure-race';")
        if wait_state.startswith("Lock:"):
            break
        if time.time() > deadline:
            raise AssertionError(f"owner erasure did not wait for admitted write: {wait_state!r}")
        time.sleep(0.02)

    blocker.stdin.write(f"select pg_advisory_unlock({write_pause_lock});\n\\q\n")
    blocker.stdin.flush()
    writer.stdin.close()
    writer.wait(timeout=5)
    eraser.wait(timeout=5)
    blocker.wait(timeout=5)
    assert writer.returncode == 0, writer.stderr.read()
    assert eraser.returncode == 0, eraser.stderr.read()
    assert sql(f"select rev from public.capture_boards where user_id='{other}';") == "2"
    confirmed_after_write = json.loads(sql(f"""set role service_role;
      select public.confirm_capture_account_erasure('{other_operation}','{other}','{session_hash}','{other_receipt}');""").splitlines()[-1])
    assert confirmed_after_write["stage"] == "polar"
    assert sql(f"set role authenticated; set request.jwt.claim.sub='{other}'; update public.capture_boards set rev=3 where user_id='{other}';") == "SET\nSET\nUPDATE 0"
    sql(f"delete from public.capture_account_erasure_operations where operation_id in ('{other_operation}','{cross_operation}');")

    # Every provider/account mutation boundary must share the same owner lock as
    # confirmation. Hold each admitted mutation transaction open, prove confirm
    # waits (rather than racing a stale pre-check), then assert the only safe
    # post-commit outcome for that boundary.
    def race_confirmation_against_mutation(label, operation, receipt, mutation_sql, pause_lock, confirm_succeeds):
        sql(f"set role service_role; select public.prepare_capture_account_erasure('{operation}','{other}','{session_hash}','{receipt}',clock_timestamp()+interval '30 minutes');")
        blocker = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
        blocker.stdin.write(f"select pg_advisory_lock({pause_lock});\n\\echo MUTATION_PAUSE_READY\n")
        blocker.stdin.flush()
        while blocker.stdout.readline().strip() != "MUTATION_PAUSE_READY":
            pass

        mutator = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
        mutator.stdin.write(f"""begin;
set application_name='capture-{label}-mutation';
set role service_role;
{mutation_sql}
\\echo MUTATION_ADMITTED
select pg_advisory_lock({pause_lock});
commit;
""")
        mutator.stdin.flush()
        while True:
            line = mutator.stdout.readline().strip()
            if line == "MUTATION_ADMITTED":
                break
            if not line and mutator.poll() is not None:
                raise AssertionError(f"{label} mutation failed before admission: {mutator.stderr.read()}")

        confirmer = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
        confirmer.stdin.write(f"""set application_name='capture-{label}-confirm';
set role service_role;
select public.confirm_capture_account_erasure('{operation}','{other}','{session_hash}','{receipt}');
""")
        confirmer.stdin.close()
        deadline = time.time() + 5
        while True:
            if confirmer.poll() is not None:
                raise AssertionError(f"{label} confirmation did not serialize on the owner lock")
            wait_state = sql(f"select coalesce(wait_event_type,'')||':'||state from pg_stat_activity where application_name='capture-{label}-confirm';")
            if wait_state.startswith("Lock:"):
                break
            if time.time() > deadline:
                raise AssertionError(f"{label} confirmation did not reach owner lock: {wait_state!r}")
            time.sleep(0.02)

        blocker.stdin.write(f"select pg_advisory_unlock({pause_lock});\n\\q\n")
        blocker.stdin.flush()
        mutator.stdin.close()
        mutator.wait(timeout=5)
        confirmer.wait(timeout=5)
        blocker.wait(timeout=5)
        assert mutator.returncode == 0, mutator.stderr.read()
        if confirm_succeeds:
            assert confirmer.returncode == 0, confirmer.stderr.read()
            assert json.loads(confirmer.stdout.read().splitlines()[-1])["stage"] == "polar"
        else:
            assert confirmer.returncode != 0
            assert "external work active" in confirmer.stderr.read().lower()

    ai_operation = "15151515-1515-4515-8515-151515151515"
    ai_admission = "16161616-1616-4616-8616-161616161616"
    race_confirmation_against_mutation(
        "managed-ai", ai_operation, "3" * 64,
        f"select public.acquire_capture_external_work('{ai_admission}','{other}','managed_ai',clock_timestamp(),clock_timestamp()+interval '2 minutes',null,null);",
        636361, False,
    )
    assert sql(f"set role service_role; select public.release_capture_external_work('{other}','{ai_admission}');").splitlines()[-1] == "t"
    sql(f"delete from public.capture_account_erasure_operations where operation_id='{ai_operation}';")

    checkout_operation = "17171717-1717-4717-8717-171717171717"
    checkout_admission = "18181818-1818-4818-8818-181818181818"
    checkout_capability = "19191919-1919-4919-8919-191919191919"
    race_confirmation_against_mutation(
        "checkout", checkout_operation, "4" * 64,
        f"select public.acquire_capture_external_work('{checkout_admission}','{other}','polar_checkout',clock_timestamp(),clock_timestamp()+interval '2 minutes','{checkout_capability}',clock_timestamp()+interval '7 days');",
        636362, False,
    )
    assert sql(f"set role service_role; select public.release_capture_external_work('{other}','{checkout_admission}');").splitlines()[-1] == "t"
    sql(f"update public.capture_external_capabilities set expires_at=clock_timestamp()-interval '1 second' where capability_id='{checkout_capability}';")
    sql(f"delete from public.capture_account_erasure_operations where operation_id='{checkout_operation}';")

    sql(f"""insert into public.capture_cloud_subscriptions(
      polar_subscription_id,user_id,status,plan,is_entitled,polar_customer_id,polar_product_id,
      current_period_start,current_period_end,access_expires_at,cancel_at_period_end,last_event_at)
      values('sub_other','{other}','active','monthly',true,'cus_other','product_1',now(),now()+interval '1 month',now()+interval '1 month',false,now());""")
    image_operation = "21212121-2121-4121-8121-212121212121"
    # reserve_capture_image_storage generates its own operation UUID; the fixed
    # erasure UUID above is independent.
    race_confirmation_against_mutation(
        "image-admission", image_operation, "5" * 64,
        f"select public.reserve_capture_image_storage('{other}','erasure-race-image',repeat('e',64),'image/png',100);",
        636363, False,
    )
    image_ticket = json.loads(sql(f"select jsonb_build_object('operationId',operation_id,'leaseId',lease_id) from public.capture_image_operations where owner_id='{other}' and image_id='erasure-race-image';"))
    assert sql(f"set role service_role; select public.mark_capture_image_operation_deleted('{other}','{image_ticket['operationId']}');").splitlines()[-1] == "t"
    sql(f"delete from public.capture_account_erasure_operations where operation_id='{image_operation}';")

    webhook_operation = "22222222-2222-4222-8222-222222222229"
    race_confirmation_against_mutation(
        "webhook", webhook_operation, "6" * 64,
        f"select public.apply_polar_subscription_event('evt_race','subscription.active',clock_timestamp(),'{other}','active','monthly',true,'cus_other','sub_other','product_1',now(),now()+interval '1 month',now()+interval '1 month',false);",
        636364, True,
    )
    assert sql(f"select is_entitled from public.capture_cloud_subscriptions where polar_subscription_id='sub_other';") == "f"
    sql(f"delete from public.capture_account_erasure_operations where operation_id='{webhook_operation}'; delete from public.polar_webhook_events where event_id='evt_race'; delete from public.capture_cloud_subscriptions where polar_subscription_id='sub_other';")

    # The production migration-chain wrapper used to lock the subscription row
    # before entering the erasure-aware base, which then requested the owner
    # lock. Confirmation takes those locks in the reverse order. Hold the owner
    # lock in one real session while a webhook arrives in the other: both calls
    # must finish without deadlock, and the confirmed fence must win.
    reverse_webhook_operation = "22222222-2222-4222-8222-222222222228"
    reverse_webhook_receipt = "d" * 64
    reverse_webhook_pause = 636366
    sql(f"""insert into public.capture_cloud_subscriptions(
      polar_subscription_id,user_id,status,plan,is_entitled,polar_customer_id,polar_product_id,
      current_period_start,current_period_end,access_expires_at,cancel_at_period_end,last_event_at)
      values('sub_reverse_webhook','{other}','active','monthly',true,'cus_reverse_webhook','product_1',
        now(),now()+interval '1 month',now()+interval '1 month',false,now());
      set role service_role;
      select public.prepare_capture_account_erasure(
        '{reverse_webhook_operation}','{other}','{session_hash}','{reverse_webhook_receipt}',
        clock_timestamp()+interval '30 minutes');""")

    blocker = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
    blocker.stdin.write(f"select pg_advisory_lock({reverse_webhook_pause});\n\\echo REVERSE_WEBHOOK_PAUSE_READY\n")
    blocker.stdin.flush()
    while blocker.stdout.readline().strip() != "REVERSE_WEBHOOK_PAUSE_READY":
        pass

    confirmer = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
    confirmer.stdin.write(f"""begin;
set application_name='capture-reverse-webhook-confirm';
set statement_timeout='5s';
set deadlock_timeout='100ms';
set role service_role;
select public.capture_account_owner_lock('{other}');
\\echo REVERSE_WEBHOOK_OWNER_HELD
select pg_advisory_lock({reverse_webhook_pause});
select public.confirm_capture_account_erasure(
  '{reverse_webhook_operation}','{other}','{session_hash}','{reverse_webhook_receipt}');
commit;
\\echo REVERSE_WEBHOOK_CONFIRMED
""")
    confirmer.stdin.flush()
    while confirmer.stdout.readline().strip() != "REVERSE_WEBHOOK_OWNER_HELD":
        if confirmer.poll() is not None:
            raise AssertionError(f"reverse webhook confirmer failed before owner lock: {confirmer.stderr.read()}")

    webhook = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
    webhook.stdin.write(f"""set application_name='capture-reverse-webhook-delivery';
set statement_timeout='5s';
set deadlock_timeout='100ms';
set role service_role;
select public.apply_polar_subscription_event(
  'evt_reverse_webhook','subscription.active',clock_timestamp(),'{other}','active','monthly',true,
  'cus_reverse_webhook','sub_reverse_webhook','product_1',now(),now()+interval '1 month',
  now()+interval '1 month',false);
""")
    webhook.stdin.close()
    deadline = time.time() + 5
    while True:
        if webhook.poll() is not None:
            raise AssertionError(f"reverse webhook did not wait for owner lock: {webhook.stderr.read()}")
        wait_state = sql("select coalesce(wait_event_type,'')||':'||state from pg_stat_activity where application_name='capture-reverse-webhook-delivery';")
        if wait_state.startswith("Lock:"):
            break
        if time.time() > deadline:
            raise AssertionError(f"reverse webhook did not reach owner lock: {wait_state!r}")
        time.sleep(0.02)

    blocker.stdin.write(f"select pg_advisory_unlock({reverse_webhook_pause});\n\\q\n")
    blocker.stdin.flush()
    confirmer.stdin.close()
    confirmer.wait(timeout=8)
    webhook.wait(timeout=8)
    blocker.wait(timeout=8)
    assert confirmer.returncode == 0, confirmer.stderr.read()
    assert webhook.returncode == 0, webhook.stderr.read()
    assert "REVERSE_WEBHOOK_CONFIRMED" in confirmer.stdout.read()
    assert webhook.stdout.read().splitlines()[-1] == "t"
    assert sql(f"select stage from public.capture_account_erasure_operations where operation_id='{reverse_webhook_operation}';") == "polar"
    assert sql("select is_entitled from public.capture_cloud_subscriptions where polar_subscription_id='sub_reverse_webhook';") == "f"
    assert sql("select count(*) from public.polar_webhook_events where event_id='evt_reverse_webhook';") == "1"
    assert sql("set role service_role; select public.apply_polar_subscription_event('evt_reverse_webhook','subscription.active',clock_timestamp(),"
               f"'{other}','active','monthly',true,'cus_reverse_webhook','sub_reverse_webhook','product_1',now(),"
               "now()+interval '1 month',now()+interval '1 month',false);").splitlines()[-1] == "f"
    assert sql(f"select stage from public.capture_account_erasure_operations where operation_id='{reverse_webhook_operation}';") == "polar"
    assert sql("select is_entitled::text||':'||(select count(*) from public.polar_webhook_events where event_id='evt_reverse_webhook')::text from public.capture_cloud_subscriptions where polar_subscription_id='sub_reverse_webhook';") == "false:1"
    print("PASS: reverse-order erasure confirmation and production-chain webhook delivery complete without deadlock; replay stays receipt-idempotent and entitlement remains denied")
    sql(f"delete from public.capture_account_erasure_operations where operation_id='{reverse_webhook_operation}'; delete from public.polar_webhook_events where event_id='evt_reverse_webhook'; delete from public.capture_cloud_subscriptions where polar_subscription_id='sub_reverse_webhook';")

    sql(f"""insert into public.capture_cloud_subscriptions(
      polar_subscription_id,user_id,status,plan,is_entitled,polar_customer_id,polar_product_id,
      current_period_start,current_period_end,access_expires_at,cancel_at_period_end,last_event_at,reconciliation_required)
      values('sub_reconcile','{other}','active','monthly',false,'cus_reconcile','product_1',now(),now()+interval '1 month',now(),false,now(),true);""")
    reconcile_operation = "23232323-2323-4323-8323-232323232323"
    race_confirmation_against_mutation(
        "reconciliation", reconcile_operation, "7" * 64,
        "select public.claim_polar_reconciliation('sub_reconcile');",
        636365, True,
    )
    assert sql(f"set role service_role; select public.acquire_capture_external_work('{uuid.uuid4()}','{other}','polar_reconcile',clock_timestamp(),clock_timestamp()+interval '2 minutes',null,null);").splitlines()[-1] == "f"
    sql(f"delete from public.capture_account_erasure_operations where operation_id='{reconcile_operation}'; delete from public.capture_cloud_subscriptions where polar_subscription_id='sub_reconcile';")

    # Reproduce the historical reverse lock order with real sessions. The first
    # session holds owner advisory lock then asks for the subscription row. The
    # reconciliation RPC starts in the opposite arrival order (subscription-id
    # serialization first) and must wait for owner lock without retaining the
    # subscription row lock; otherwise PostgreSQL detects a deadlock.
    def reverse_owner_subscription_race(label, contender_sql, pause_lock):
        sub = f"sub_reverse_{label}"
        sql(f"""insert into public.capture_cloud_subscriptions(
          polar_subscription_id,user_id,status,plan,is_entitled,polar_customer_id,polar_product_id,
          current_period_start,current_period_end,access_expires_at,cancel_at_period_end,last_event_at,
          reconciliation_required,state_version,reconcile_after)
          values('{sub}','{other}','active','monthly',false,'cus_reverse_{label}','product_1',now(),
            now()+interval '1 month',now(),false,now(),true,0,'-infinity');""")

        blocker = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
        blocker.stdin.write(f"select pg_advisory_lock({pause_lock});\n\\echo REVERSE_PAUSE_READY\n")
        blocker.stdin.flush()
        while blocker.stdout.readline().strip() != "REVERSE_PAUSE_READY":
            pass

        owner_first = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
        owner_first.stdin.write(f"""begin;
set application_name='capture-reverse-owner-{label}';
set statement_timeout='5s';
select public.capture_account_owner_lock('{other}');
\\echo OWNER_LOCK_HELD
select pg_advisory_lock({pause_lock});
select polar_subscription_id from public.capture_cloud_subscriptions
  where polar_subscription_id='{sub}' for update;
commit;
\\echo OWNER_ROW_COMMITTED
""")
        owner_first.stdin.flush()
        while owner_first.stdout.readline().strip() != "OWNER_LOCK_HELD":
            if owner_first.poll() is not None:
                raise AssertionError(f"{label} owner-first session failed: {owner_first.stderr.read()}")

        contender = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
        contender.stdin.write(f"""set application_name='capture-reverse-contender-{label}';
set statement_timeout='5s';
set role service_role;
{contender_sql(sub)}
""")
        contender.stdin.close()
        deadline = time.time() + 5
        while True:
            if contender.poll() is not None:
                raise AssertionError(f"{label} contender did not wait for owner lock: {contender.stderr.read()}")
            wait_state = sql(f"select coalesce(wait_event_type,'')||':'||state from pg_stat_activity where application_name='capture-reverse-contender-{label}';")
            if wait_state.startswith("Lock:"):
                break
            if time.time() > deadline:
                raise AssertionError(f"{label} contender did not reach owner lock: {wait_state!r}")
            time.sleep(0.02)

        blocker.stdin.write(f"select pg_advisory_unlock({pause_lock});\n\\q\n")
        blocker.stdin.flush()
        owner_first.stdin.close()
        owner_first.wait(timeout=8)
        contender.wait(timeout=8)
        blocker.wait(timeout=8)
        assert owner_first.returncode == 0, owner_first.stderr.read()
        assert contender.returncode == 0, contender.stderr.read()
        assert "OWNER_ROW_COMMITTED" in owner_first.stdout.read()
        sql(f"delete from public.polar_webhook_events where polar_subscription_id='{sub}'; delete from public.capture_cloud_subscriptions where polar_subscription_id='{sub}';")

    reverse_owner_subscription_race(
        "invalid",
        lambda sub: f"select public.queue_invalid_polar_event('{sub}','evt_reverse_invalid','subscription.canceled',clock_timestamp());",
        646461,
    )
    reverse_owner_subscription_race(
        "claim",
        lambda sub: f"select public.claim_polar_reconciliation('{sub}');",
        646462,
    )
    finish_snapshot = json.dumps({
        "userId": other, "polarSubscriptionId": "SUBSCRIPTION", "polarCustomerId": "CUSTOMER",
        "polarProductId": "product_1", "status": "canceled", "plan": "monthly",
        "isEntitled": False, "cancelAtPeriodEnd": True,
        "currentPeriodStart": "2026-09-01T00:00:00Z", "currentPeriodEnd": "2026-10-01T00:00:00Z",
        "accessExpiresAt": "2026-10-01T00:00:00Z",
    })
    reverse_owner_subscription_race(
        "finish",
        lambda sub: "select public.finish_polar_reconciliation(" +
            f"'{sub}',0,'{finish_snapshot.replace('SUBSCRIPTION', sub).replace('CUSTOMER', 'cus_reverse_finish')}'::jsonb);",
        646463,
    )
    print("PASS: board, image admission/publication, checkout, webhook, reconciliation, and managed-AI confirmation races serialize on the durable owner fence; reverse owner/subscription races do not deadlock")

    prepared = json.loads(sql(f"""set role service_role; select public.prepare_capture_account_erasure(
      '{operation_id}','{owner}','{session_hash}','{receipt_hash}',clock_timestamp()+interval '30 minutes');""" ).splitlines()[-1])
    assert prepared["stage"] == "prepared" and prepared["ownerId"] == owner
    # Lost prepare response rotates the secret on the same random operation.
    rotated = "c" * 64
    repeated = json.loads(sql(f"""set role service_role; select public.prepare_capture_account_erasure(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','{owner}','{session_hash}','{rotated}',clock_timestamp()+interval '30 minutes');""").splitlines()[-1])
    assert repeated["operationId"] == operation_id
    assert sql(f"set role service_role; select public.status_capture_account_erasure('{operation_id}','{receipt_hash}','{owner}','{session_hash}');") == "SET"
    assert sql(f"set role service_role; select public.status_capture_account_erasure('{operation_id}','{'d' * 64}','{owner}','{session_hash}');") == "SET"

    # Deterministic confirmation-vs-cleanup race. Confirmation changes the row
    # to polar while holding its row lock, then waits behind a session advisory
    # lock until the original prepared receipt is observably expired. Cleanup
    # must SKIP the locked candidate; after commit the durable obligation/fence
    # remains and the repeated DELETE predicates reject it.
    race_operation = "99999999-9999-4999-8999-999999999999"
    race_receipt = "9" * 64
    sql(f"set role service_role; select public.prepare_capture_account_erasure('{race_operation}','{race_owner}','{session_hash}','{race_receipt}',clock_timestamp()+interval '2 seconds');")
    blocker = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
    blocker.stdin.write("select pg_advisory_lock(424242);\n\\echo BLOCKER\n")
    blocker.stdin.flush()
    while blocker.stdout.readline().strip() != "BLOCKER":
        pass
    confirmer = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
    confirmer.stdin.write(f"begin;\nset role service_role;\nselect public.confirm_capture_account_erasure('{race_operation}','{race_owner}','{session_hash}','{race_receipt}');\n\\echo CONFIRMED_LOCKED\nselect pg_advisory_lock(424242);\ncommit;\n\\echo CONFIRMED_COMMITTED\n")
    confirmer.stdin.flush()
    while confirmer.stdout.readline().strip() != "CONFIRMED_LOCKED":
        pass
    deadline = time.time() + 5
    while sql(f"select receipt_expires_at <= clock_timestamp() from public.capture_account_erasure_operations where operation_id='{race_operation}';") != "t":
        if time.time() > deadline:
            raise AssertionError("race receipt did not expire")
        time.sleep(0.02)
    assert sql("set role service_role; select public.cleanup_capture_account_erasure_receipts();").splitlines()[-1] == "0"
    blocker.stdin.write("select pg_advisory_unlock(424242);\n\\q\n")
    blocker.stdin.flush()
    confirmer.stdin.close()
    confirmer.wait(timeout=5)
    assert confirmer.returncode == 0, confirmer.stderr.read()
    blocker.wait(timeout=5)
    assert sql(f"select stage from public.capture_account_erasure_operations where operation_id='{race_operation}';") == "polar"
    sql(f"delete from public.capture_account_erasure_operations where operation_id='{race_operation}';")

    # Prepared/unconfirmed exact-owner recovery reads remain available. These
    # authenticated SELECTs exercise the same RLS semantics exposed by direct
    # PostgREST table reads, not only the application route.
    assert sql(f"set role authenticated; set request.jwt.claim.sub='{owner}'; select rev from public.capture_boards where user_id='{owner}';").splitlines()[-1] == "1"
    assert sql(f"set role authenticated; set request.jwt.claim.sub='{owner}'; select count(*) from public.capture_cloud_subscriptions where user_id='{owner}';").splitlines()[-1] == "1"
    assert sql(f"set role authenticated; set request.jwt.claim.sub='{owner}'; select count(*) from public.capture_image_publications where user_id='{owner}' and image_id='photo';").splitlines()[-1] == "1"
    assert sql(f"set role authenticated; set request.jwt.claim.sub='{owner}'; select name from storage.objects where name='{owner}/photo';").splitlines()[-1] == f"{owner}/photo"

    # Confirmation cannot pass an active external provider call.
    admission = "11111111-1111-4111-8111-111111111111"
    assert sql(f"set role service_role; select public.acquire_capture_external_work('{admission}','{owner}','managed_ai',clock_timestamp(),clock_timestamp()+interval '2 minutes',null,null);").splitlines()[-1] == "t"
    assert "external work active" in sql(f"set role service_role; select public.confirm_capture_account_erasure('{operation_id}','{owner}','{session_hash}','{rotated}');", ok=False)
    assert sql(f"set role service_role; select public.release_capture_external_work('{owner}','{admission}');").splitlines()[-1] == "t"

    # Independent DB sessions can admit concurrently, and confirmation waits
    # for every owner-bound admission rather than one in-process promise.
    third_operation = "88888888-8888-4888-8888-888888888888"
    third_receipt = "8" * 64
    sql(f"set role service_role; select public.prepare_capture_account_erasure('{third_operation}','{third}','{session_hash}','{third_receipt}',clock_timestamp()+interval '30 minutes');")
    concurrent_ids = ["66666666-6666-4666-8666-666666666666", "77777777-7777-4777-8777-777777777777"]
    def admit(admission_id):
        return sql(f"set role service_role; select public.acquire_capture_external_work('{admission_id}','{third}','managed_ai',clock_timestamp(),clock_timestamp()+interval '2 minutes',null,null);").splitlines()[-1]
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(admit, concurrent_ids)) == ["t", "t"]
    assert "external work active" in sql(f"set role service_role; select public.confirm_capture_account_erasure('{third_operation}','{third}','{session_hash}','{third_receipt}');", ok=False)
    assert sql(f"set role service_role; select public.release_capture_external_work('{third}','{concurrent_ids[0]}');").splitlines()[-1] == "t"
    assert "external work active" in sql(f"set role service_role; select public.confirm_capture_account_erasure('{third_operation}','{third}','{session_hash}','{third_receipt}');", ok=False)
    assert sql(f"set role service_role; select public.release_capture_external_work('{third}','{concurrent_ids[1]}');").splitlines()[-1] == "t"
    sql(f"delete from public.capture_account_erasure_operations where operation_id='{third_operation}';")

    # This is a genuinely expired prepared receipt, not a future timestamp
    # described as expired by the test name.
    expired_operation = "aaaaaaaa-1111-4111-8111-111111111111"
    sql(f"set role service_role; select public.prepare_capture_account_erasure('{expired_operation}','{third}','{session_hash}','{'7' * 64}',clock_timestamp()+interval '30 minutes');")
    sql(f"update public.capture_account_erasure_operations set receipt_expires_at=clock_timestamp()-interval '1 second' where operation_id='{expired_operation}';")
    assert sql("set role service_role; select public.cleanup_capture_account_erasure_receipts();").splitlines()[-1] == "1"
    assert sql(f"select count(*) from public.capture_account_erasure_operations where operation_id='{expired_operation}';") == "0"

    # Checkout/portal capability reservations are durable even after release.
    billing_admission = "22222222-2222-4222-8222-222222222222"
    capability = "33333333-3333-4333-8333-333333333333"
    assert sql(f"set role service_role; select public.acquire_capture_external_work('{billing_admission}','{owner}','polar_checkout',clock_timestamp(),clock_timestamp()+interval '2 minutes','{capability}',clock_timestamp()+interval '7 days');").splitlines()[-1] == "t"
    assert sql(f"set role service_role; select public.release_capture_external_work('{owner}','{billing_admission}');").splitlines()[-1] == "t"
    assert "unexpired external capability" in sql(f"set role service_role; select public.confirm_capture_account_erasure('{operation_id}','{owner}','{session_hash}','{rotated}');", ok=False)
    sql(f"update public.capture_external_capabilities set expires_at=clock_timestamp()-interval '1 second' where capability_id='{capability}';")

    # A lost release is reclaimed only at the durable lease boundary.
    lost = "44444444-4444-4444-8444-444444444444"
    assert sql(f"set role service_role; select public.acquire_capture_external_work('{lost}','{owner}','managed_ai',clock_timestamp(),clock_timestamp()+interval '2 minutes',null,null);").splitlines()[-1] == "t"
    sql(f"update public.capture_external_work_admissions set lease_expires_at=clock_timestamp()-interval '1 second' where admission_id='{lost}';")

    confirmed = json.loads(sql(f"""set role service_role; select public.confirm_capture_account_erasure(
      '{operation_id}','{owner}','{session_hash}','{rotated}');""").splitlines()[-1])
    assert confirmed["stage"] == "polar"
    duplicate = json.loads(sql(f"""set role service_role; select public.confirm_capture_account_erasure(
      '{operation_id}','{owner}','{session_hash}','{rotated}');""").splitlines()[-1])
    assert duplicate["stage"] == "polar" and duplicate["version"] == confirmed["version"]
    assert sql(f"select public.capture_account_deleting('{owner}');") == "t"
    assert "exact owner required" in sql(f"set role authenticated; set request.jwt.claim.sub='{other}'; select public.capture_account_deleting('{owner}');", ok=False)
    assert sql("select is_entitled from public.capture_cloud_subscriptions where polar_subscription_id='sub_1';") == "f"

    # Fence behavior, not duplicate-key behavior: distinct writes disappear or
    # reject and existing rows remain unchanged.
    assert sql(f"set role authenticated; set request.jwt.claim.sub='{owner}'; update public.capture_boards set rev=99 where user_id='{owner}';") == "SET\nSET\nUPDATE 0"
    assert sql(f"select rev from public.capture_boards where user_id='{owner}';") == "1"
    denied = sql(f"set role authenticated; set request.jwt.claim.sub='{owner}'; insert into public.capture_image_publications values('{owner}','new-photo','55555555-5555-4555-8555-555555555555');", ok=False)
    assert "account write fenced" in denied or "row-level security" in denied or "permission denied" in denied
    denied = sql(f"set role authenticated; set request.jwt.claim.sub='{owner}'; insert into storage.objects values('capture-images','{owner}/new-photo');", ok=False)
    assert "row-level security" in denied
    for query in [
      f"select rev from public.capture_boards where user_id='{owner}';",
      f"select count(*) from public.capture_cloud_subscriptions where user_id='{owner}';",
      f"select image_id from public.capture_image_publications where user_id='{owner}';",
      f"select name from storage.objects where name='{owner}/photo';",
    ]:
      output = sql(f"set role authenticated; set request.jwt.claim.sub='{owner}'; {query}")
      if "count(*) from public.capture_cloud_subscriptions" in query:
        assert output.splitlines()[-1] == "0"
      else:
        assert output == "SET\nSET"
    assert "owner unavailable" in sql(f"set role authenticated; set request.jwt.claim.sub='{owner}'; select public.consume_capture_cloud_quota('board_write');", ok=False)
    assert sql(f"set role authenticated; set request.jwt.claim.sub='{other}'; update public.capture_boards set rev=99 where user_id='{owner}';") == "SET\nSET\nUPDATE 0"

    late = f"""set role service_role; select public.apply_polar_subscription_event(
      'evt_late','subscription.active',clock_timestamp(),'{owner}','active','monthly',true,
      'cus_1','sub_1','product_1',now(),now()+interval '1 month',now()+interval '1 month',false);"""
    assert sql(late).splitlines()[-1] == "t"
    assert sql("select count(*) from public.polar_webhook_events where event_id='evt_late';") == "1"
    assert sql("select is_entitled from public.capture_cloud_subscriptions where polar_subscription_id='sub_1';") == "f"
    assert json.loads(sql("set role service_role; select public.claim_polar_reconciliation('sub_1');").splitlines()[-1]) == {"pending": False}

    # Two real PostgreSQL workers race for one lease; exactly one wins.
    worker_leases = [str(uuid.uuid4()), str(uuid.uuid4())]
    def claim(lease):
        return sql(f"set role service_role; select public.claim_capture_account_erasure('{lease}',clock_timestamp(),clock_timestamp()+interval '30 seconds');")
    with ThreadPoolExecutor(max_workers=2) as pool:
        claims = list(pool.map(claim, worker_leases))
    tickets = [json.loads(value.splitlines()[-1]) for value in claims if value.splitlines()[-1].startswith("{")]
    assert len(tickets) == 1 and tickets[0]["leaseId"] in worker_leases
    orphan_admission = "12121212-1212-4212-8212-121212121212"
    sql(f"insert into public.capture_external_work_admissions(admission_id,owner_id,kind,lease_expires_at) values('{orphan_admission}','{owner}','managed_ai',clock_timestamp()+interval '2 minutes');")
    assert "external work active" in sql(f"set role service_role; select public.advance_capture_account_erasure('{operation_id}','{owner}','{tickets[0]['leaseId']}',{tickets[0]['version']},'polar','sessions',clock_timestamp());", ok=False)
    sql(f"delete from public.capture_external_work_admissions where admission_id='{orphan_admission}';")
    sql(f"update public.capture_account_erasure_operations set lease_expires_at=clock_timestamp()-interval '1 second' where operation_id='{operation_id}';")

    # A delivery after the Polar stage has advanced atomically rewinds the
    # durable operation and invalidates the stale worker version/lease.
    sweep_lease = str(uuid.uuid4())
    sweep_ticket = json.loads(sql(f"set role service_role; select public.claim_capture_account_erasure('{sweep_lease}',clock_timestamp(),clock_timestamp()+interval '30 seconds');").splitlines()[-1])
    assert sql(f"set role service_role; select public.advance_capture_account_erasure('{operation_id}','{owner}','{sweep_lease}',{sweep_ticket['version']},'polar','sessions',clock_timestamp());").splitlines()[-1] == "t"
    assert sql(late.replace("evt_late", "evt_after_polar_sweep")).splitlines()[-1] == "t"
    assert sql(f"select stage||':'||(lease_id is null)::text from public.capture_account_erasure_operations where operation_id='{operation_id}';") == "polar:true"

    stage = "polar"
    for next_stage in ["sessions", "storage", "app_rows"]:
        lease = str(uuid.uuid4())
        ticket = json.loads(sql(f"set role service_role; select public.claim_capture_account_erasure('{lease}',clock_timestamp(),clock_timestamp()+interval '30 seconds');").splitlines()[-1])
        assert ticket["stage"] == stage
        assert sql(f"set role service_role; select public.advance_capture_account_erasure('{operation_id}','{owner}','{lease}',{ticket['version']},'{stage}','{next_stage}',clock_timestamp());").splitlines()[-1] == "t"
        stage = next_stage

    lease = str(uuid.uuid4())
    ticket = json.loads(sql(f"set role service_role; select public.claim_capture_account_erasure('{lease}',clock_timestamp(),clock_timestamp()+interval '30 seconds');").splitlines()[-1])
    assert ticket["stage"] == "app_rows"
    assert sql(f"set role service_role; select public.delete_capture_account_app_rows('{owner}');").splitlines()[-1] == "t"
    assert sql(f"set role service_role; select public.capture_account_app_rows_exist('{owner}');").splitlines()[-1] == "f"
    assert sql(f"select count(*) from public.capture_image_operations where owner_id='{owner}';") == "0"
    assert sql(f"select count(*) from public.capture_image_owner_usage where owner_id='{owner}';") == "0"
    assert sql(f"set role service_role; select public.advance_capture_account_erasure('{operation_id}','{owner}','{lease}',{ticket['version']},'app_rows','auth',clock_timestamp());").splitlines()[-1] == "t"

    auth_lease = str(uuid.uuid4())
    auth_ticket = json.loads(sql(f"set role service_role; select public.claim_capture_account_erasure('{auth_lease}',clock_timestamp(),clock_timestamp()+interval '30 seconds');").splitlines()[-1])
    assert auth_ticket["stage"] == "auth"
    assert sql(f"set role service_role; select public.authorize_capture_account_auth_deletion('{operation_id}','{owner}','{auth_lease}',{auth_ticket['version']});").splitlines()[-1] == "t"
    sql(f"delete from auth.users where id='{owner}';")
    assert sql(f"select owner_id='{owner}' from public.capture_account_erasure_operations where operation_id='{operation_id}';") == "t"
    assert sql(f"set role service_role; select public.advance_capture_account_erasure('{operation_id}','{owner}','{auth_lease}',{auth_ticket['version']},'auth','complete',clock_timestamp());").splitlines()[-1] == "t"
    assert sql(f"select owner_id is null from public.capture_account_erasure_operations where operation_id='{operation_id}';") == "t"
    completed = json.loads(sql(f"set role service_role; select public.status_capture_account_erasure('{operation_id}','{rotated}',null,null);").splitlines()[-1])
    assert completed["stage"] == "complete" and completed["ownerId"] is None and completed["completedAt"]
    assert sql(f"select receipt_expires_at <= completed_at + interval '30 days' from public.capture_account_erasure_operations where operation_id='{operation_id}';") == "t"

    # Signed delivery after Auth deletion is retained without recreating access.
    assert sql(late.replace("evt_late", "evt_after_auth")).splitlines()[-1] == "f"
    assert sql("select user_id is null from public.polar_webhook_events where event_id='evt_after_auth';") == "t"
    assert sql("select count(*) from public.capture_cloud_subscriptions where polar_subscription_id='sub_1';") == "0"
    print("PASS: account erasure SQL receipt race, worker/admission concurrency, read/write fence, capability expiry, late webhook rewind, app/Auth readback")
finally:
    sql(f"drop database if exists {database} with (force);", db="postgres")
