"""Exercise operational retention in an existing socket-only PostgreSQL cluster."""
import json
import pathlib
import subprocess
import sys
import time
import uuid

socket = pathlib.Path(sys.argv[1])
port = sys.argv[2]
if not socket.is_absolute() or not (socket / f".s.PGSQL.{port}").is_socket():
    raise SystemExit("An existing absolute local PostgreSQL socket directory is required")
root = pathlib.Path(__file__).resolve().parents[1]
database = "capture_retention_test_" + uuid.uuid4().hex
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
active_owner = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
operation = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
contended_owner = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
reverse_owner = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"

sql(f"create database {database};", db="postgres")
try:
    sql("""
    do $$ begin
      if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select from pg_roles where rolname='service_role') then create role service_role; end if;
    end $$;
    create schema auth;
    create table auth.users(id uuid primary key);
    create table public.capture_boards(
      user_id uuid primary key, board jsonb not null default '{}'::jsonb,
      tombstones jsonb not null default '[]'::jsonb, rev bigint not null default 1,
      updated_at timestamptz not null default now()
    );
    create table public.capture_cloud_quota_policies(
      scope text primary key, request_limit integer not null, window_seconds integer not null
    );
    create table public.capture_cloud_owner_quotas(
      user_id uuid not null, scope text not null, window_started_at timestamptz not null,
      request_count integer not null, updated_at timestamptz not null default now(),
      primary key(user_id,scope)
    );
    create table public.capture_cloud_subscriptions(
      polar_subscription_id text primary key,
      user_id uuid not null references auth.users(id) on delete cascade,
      status text not null check(status in ('trialing','active','past_due','canceled','revoked','paused','inactive')),
      plan text check(plan in ('monthly','yearly')),
      is_entitled boolean not null default false,
      polar_customer_id text not null,
      polar_product_id text not null,
      current_period_start timestamptz,
      current_period_end timestamptz,
      access_expires_at timestamptz,
      cancel_at_period_end boolean not null default false,
      last_event_at timestamptz not null,
      reconciliation_required boolean not null default false,
      authoritative_mode boolean not null default false,
      state_version bigint not null default 0,
      reconcile_after timestamptz not null default '-infinity',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.polar_webhook_events(
      event_id text primary key, event_type text not null, user_id uuid,
      polar_subscription_id text, event_created_at timestamptz not null,
      processed_at timestamptz not null default now()
    );
    create table public.capture_account_erasure_operations(
      operation_id uuid primary key, owner_id uuid, session_id_hash text,
      receipt_secret_hash text not null, stage text not null,
      lease_id uuid, lease_expires_at timestamptz, version bigint not null default 1,
      attempt_count integer not null default 0, retry_count integer not null default 0,
      retry_after timestamptz, last_error_code text, confirmed_at timestamptz,
      completed_at timestamptz, receipt_expires_at timestamptz not null,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table public.capture_external_work_admissions(
      admission_id uuid primary key, owner_id uuid not null, kind text not null,
      lease_expires_at timestamptz not null, created_at timestamptz not null default now()
    );
    create table public.capture_external_capabilities(
      capability_id uuid primary key, owner_id uuid not null, kind text not null,
      expires_at timestamptz not null, created_at timestamptz not null default now()
    );
    create table public.capture_image_operations(
      operation_id uuid primary key, owner_id uuid not null, state text not null,
      lease_expires_at timestamptz not null, finalized_at timestamptz
    );
    create table public.capture_image_owner_usage(
      owner_id uuid primary key, reserved_objects integer not null, reserved_bytes bigint not null
    );
    create table public.capture_image_storage_policy(
      singleton boolean primary key, max_objects integer not null, max_bytes bigint not null
    );
    create function public.capture_account_owner_lock(p_user_id uuid)
    returns void language sql security definer set search_path='' as $$
      select pg_advisory_xact_lock(hashtextextended(p_user_id::text,912221));
    $$;
    create function public.capture_image_admission_ready()
    returns boolean language sql stable security definer set search_path='' as 'select true';
    """)
    sql((root / "supabase/migrations/20260922300000_operational_retention.sql").read_text())
    sql(f"""
    insert into auth.users values
      ('{owner}'),('{active_owner}'),('{contended_owner}'),('{reverse_owner}');
    insert into public.capture_cloud_quota_policies values('managed_ai',100,3600);
    insert into public.capture_cloud_owner_quotas values
      ('{owner}','managed_ai',now()-interval '20 days',100,now()-interval '20 days'),
      ('{active_owner}','managed_ai',now(),95,now());
    insert into public.capture_cloud_subscriptions(
      polar_subscription_id,user_id,status,plan,is_entitled,polar_customer_id,
      polar_product_id,current_period_start,current_period_end,access_expires_at,
      cancel_at_period_end,last_event_at,reconciliation_required,authoritative_mode,
      state_version,reconcile_after,created_at,updated_at
    ) values
      ('terminal','{owner}','canceled','monthly',false,'customer-terminal','product-monthly',
        now()-interval '700 days',now()-interval '500 days',now()-interval '500 days',true,
        now()-interval '500 days',false,false,4,'-infinity',now()-interval '700 days',now()-interval '500 days'),
      ('reconciling','{owner}','revoked','yearly',false,'customer-reconciling','product-yearly',
        now()-interval '800 days',now()-interval '500 days',now()-interval '500 days',false,
        now()-interval '500 days',true,true,8,now()-interval '2 hours',now()-interval '800 days',now()-interval '500 days'),
      ('active','{active_owner}','active','monthly',true,'customer-active','product-monthly',
        now()-interval '20 days',now()+interval '10 days',now()+interval '10 days',false,
        now()-interval '1 day',false,false,2,'-infinity',now()-interval '20 days',now());
    insert into public.polar_webhook_events values
      ('old-terminal','subscription.updated','{owner}','terminal',now()-interval '550 days',now()-interval '550 days'),
      ('authoritative-tie-a','subscription.updated','{owner}','terminal',(select last_event_at from public.capture_cloud_subscriptions where polar_subscription_id='terminal'),now()-interval '490 days'),
      ('authoritative-tie-b','subscription.canceled','{owner}','terminal',(select last_event_at from public.capture_cloud_subscriptions where polar_subscription_id='terminal'),now()-interval '480 days'),
      ('delayed-stale-latest','subscription.updated','{owner}','terminal',now()-interval '600 days',now()-interval '470 days'),
      ('reconciliation-receipt','subscription.revoked','{owner}','reconciling',(select last_event_at from public.capture_cloud_subscriptions where polar_subscription_id='reconciling'),now()-interval '490 days'),
      ('active-fiscal','subscription.active','{active_owner}','active',now()-interval '500 days',now()-interval '500 days');
    insert into public.capture_external_work_admissions values
      ('11111111-1111-4111-8111-111111111111','{owner}','managed_ai',now()-interval '8 days',now()-interval '9 days'),
      ('22222222-2222-4222-8222-222222222222','{active_owner}','managed_ai',now()+interval '1 hour',now());
    insert into public.capture_external_capabilities values
      ('33333333-3333-4333-8333-333333333333','{owner}','polar_checkout',now()-interval '8 days',now()-interval '20 days'),
      ('44444444-4444-4444-8444-444444444444','{active_owner}','polar_portal',now()+interval '1 day',now());
    insert into public.capture_image_operations values
      ('55555555-5555-4555-8555-555555555555','{owner}','released',now()-interval '100 days',now()-interval '100 days'),
      ('66666666-6666-4666-8666-666666666666','{owner}','abandoned',now()-interval '100 days',now()-interval '100 days'),
      ('77777777-7777-4777-8777-777777777777','{owner}','published',now()-interval '100 days',now()-interval '100 days');
    insert into public.capture_image_owner_usage values('{owner}',2,200),('{active_owner}',95,950);
    insert into public.capture_image_storage_policy values(true,100,1000);
    insert into public.capture_account_erasure_operations(
      operation_id,owner_id,receipt_secret_hash,stage,confirmed_at,completed_at,
      receipt_expires_at,attempt_count,retry_count
    ) values
      ('{operation}',null,repeat('a',64),'complete',now()-interval '40 days',now()-interval '40 days',now()-interval '10 days',2,1),
      ('88888888-8888-4888-8888-888888888888','{owner}',repeat('b',64),'prepared',null,null,now()-interval '1 day',0,0),
      ('99999999-9999-4999-8999-999999999999','{active_owner}',repeat('c',64),'polar',now()-interval '2 days',null,now()+interval '1 day',12,10),
      ('12121212-1212-4212-8212-121212121212',null,repeat('d',64),'complete',now()-interval '1 day',now()-interval '1 day',now()+interval '29 days',1,0);
    insert into public.capture_boards(user_id,tombstones,updated_at)
      select gen_random_uuid(),jsonb_build_array(
        jsonb_build_object('kind','action','id','old','deletedAt',
          extract(epoch from now()-interval '31 days')*1000),
        jsonb_build_object('kind','action','id','new','deletedAt',
          extract(epoch from now()-interval '1 day')*1000)
      ),now()-interval '100 days'
      from generate_series(1,105);
    update public.capture_boards set
      board=jsonb_build_object('pendingCaptures',jsonb_build_array(jsonb_build_object('id','pending')))
      where user_id=(select user_id from public.capture_boards order by user_id limit 1);
    """)

    first = json.loads(sql("select public.run_capture_operational_maintenance(gen_random_uuid(),clock_timestamp(),clock_timestamp()+interval '55 seconds');"))
    assert first["outcome"] == "completed" and first["changedCount"] >= 106
    assert sql("select count(*) from public.capture_boards where jsonb_array_length(tombstones)=2;") == "5"
    assert sql("select count(*) from public.capture_boards where rev=2;") == "100"
    assert sql("select count(*) from public.capture_boards where jsonb_array_length(board->'pendingCaptures')=1;") == "1"
    assert sql("select count(*) from public.capture_cloud_owner_quotas;") == "1"
    assert sql("select count(*) from public.capture_cloud_subscriptions;") == "3"
    assert sql("select count(*) from public.polar_webhook_events where event_id='old-terminal';") == "0"
    assert sql("""
      select count(*) from public.polar_webhook_events event
      join public.capture_cloud_subscriptions subscription
        on subscription.polar_subscription_id=event.polar_subscription_id
      where event.event_id in ('authoritative-tie-a','authoritative-tie-b')
        and event.event_created_at=subscription.last_event_at;
    """) == "2"
    assert sql("select count(*) from public.polar_webhook_events where event_id='delayed-stale-latest';") == "1"
    assert sql("""
      select event_id from public.polar_webhook_events
      where polar_subscription_id='terminal'
      order by processed_at desc,event_id desc limit 1;
    """) == "delayed-stale-latest"
    assert sql("""
      select count(*) from public.polar_webhook_events event
      join public.capture_cloud_subscriptions subscription
        on subscription.polar_subscription_id=event.polar_subscription_id
      where event.event_id='reconciliation-receipt'
        and subscription.reconciliation_required;
    """) == "1"
    assert sql("select count(*) from public.polar_webhook_events where event_id='active-fiscal';") == "1"
    assert sql("select count(*) from public.capture_external_work_admissions;") == "1"
    assert sql("select count(*) from public.capture_external_capabilities;") == "1"
    assert sql("select string_agg(state,',' order by state) from public.capture_image_operations;") == "abandoned,published"
    assert sql("select string_agg(reserved_objects::text||':'||reserved_bytes::text,',' order by owner_id) from public.capture_image_owner_usage;") == "2:200,95:950"
    assert sql(f"select count(*) from public.capture_account_erasure_evidence where operation_id='{operation}';") == "1"
    assert sql(f"select count(*) from public.capture_account_erasure_operations where operation_id='{operation}';") == "0"
    assert sql("select count(*) from public.capture_account_erasure_operations where stage in ('polar','complete');") == "2"

    second = json.loads(sql("select public.run_capture_operational_maintenance(gen_random_uuid(),clock_timestamp(),clock_timestamp()+interval '55 seconds');"))
    assert second["outcome"] == "completed" and second["changedCount"] == 5
    third = json.loads(sql("select public.run_capture_operational_maintenance(gen_random_uuid(),clock_timestamp(),clock_timestamp()+interval '55 seconds');"))
    assert third == {"outcome": "completed", "changedCount": 0}
    assert sql("select count(*) from public.capture_boards where jsonb_array_length(tombstones)=1 and rev=2;") == "105"

    # More than a full batch from one contended owner must not starve unrelated
    # owners. Exercise both admissions and capabilities with deterministic old
    # rows, then prove every skipped row is removed by bounded replay batches.
    sql(f"""
      insert into public.capture_external_work_admissions
        (admission_id,owner_id,kind,lease_expires_at,created_at)
      select md5('blocked-admission-'||ordinal)::uuid,'{contended_owner}',
        'managed_ai',now()-interval '20 days'-ordinal*interval '1 second',now()-interval '21 days'
      from generate_series(1,120) ordinal;
      insert into public.capture_external_work_admissions values
        ('14141414-1414-4414-8414-141414141414','{reverse_owner}','managed_ai',now()-interval '8 days',now()-interval '9 days');
      insert into public.capture_external_capabilities
        (capability_id,owner_id,kind,expires_at,created_at)
      select md5('blocked-capability-'||ordinal)::uuid,'{contended_owner}',
        'polar_checkout',now()-interval '20 days'-ordinal*interval '1 second',now()-interval '21 days'
      from generate_series(1,120) ordinal;
      insert into public.capture_external_capabilities values
        ('15151515-1515-4515-8515-151515151515','{reverse_owner}','polar_checkout',now()-interval '8 days',now()-interval '9 days');
    """)
    owner_blocker = subprocess.Popen(
        base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, env=env, bufsize=1,
    )
    try:
        owner_blocker.stdin.write(
            f"begin; select pg_advisory_xact_lock(hashtextextended('{contended_owner}',912221));\\echo OWNER_HELD\n"
        )
        owner_blocker.stdin.flush()
        while owner_blocker.stdout.readline().strip() != "OWNER_HELD":
            pass
        bounded_output = sql("""
          select set_config('statement_timeout','750ms',false);
          select public.run_capture_operational_maintenance(
            gen_random_uuid(),clock_timestamp(),clock_timestamp()+interval '55 seconds');
        """)
        bounded = json.loads(bounded_output.splitlines()[-1])
        assert bounded["outcome"] == "completed" and bounded["changedCount"] == 2
        assert sql("select count(*) from public.capture_external_work_admissions where admission_id='14141414-1414-4414-8414-141414141414';") == "0"
        assert sql("select count(*) from public.capture_external_capabilities where capability_id='15151515-1515-4515-8515-151515151515';") == "0"
        assert sql(f"select count(*) from public.capture_external_work_admissions where owner_id='{contended_owner}';") == "120"
        assert sql(f"select count(*) from public.capture_external_capabilities where owner_id='{contended_owner}';") == "120"
    finally:
        if owner_blocker.poll() is None:
            owner_blocker.stdin.write("rollback;\\q\n")
            owner_blocker.stdin.flush()
            owner_blocker.wait(timeout=5)
    replay = json.loads(sql("select public.run_capture_operational_maintenance(gen_random_uuid(),clock_timestamp(),clock_timestamp()+interval '55 seconds');"))
    assert replay["outcome"] == "completed" and replay["changedCount"] == 200
    assert sql(f"select count(*) from public.capture_external_work_admissions where owner_id='{contended_owner}';") == "20"
    assert sql(f"select count(*) from public.capture_external_capabilities where owner_id='{contended_owner}';") == "20"
    replay_tail = json.loads(sql("select public.run_capture_operational_maintenance(gen_random_uuid(),clock_timestamp(),clock_timestamp()+interval '55 seconds');"))
    assert replay_tail["outcome"] == "completed" and replay_tail["changedCount"] == 40
    assert sql(f"select count(*) from public.capture_external_work_admissions where owner_id='{contended_owner}';") == "0"
    assert sql(f"select count(*) from public.capture_external_capabilities where owner_id='{contended_owner}';") == "0"

    # Exercise the historical deadlock order directly: one transaction owns the
    # owner lock and then requests the row while maintenance considers row then
    # owner. Both statements have hard timeouts and must complete; replay remains
    # safe whether the owner transaction or maintenance deleted the candidate.
    sql(f"""
      insert into public.capture_external_work_admissions values
        ('16161616-1616-4616-8616-161616161616','{reverse_owner}','managed_ai',now()-interval '8 days',now()-interval '9 days');
    """)
    reverse = subprocess.Popen(
        base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, env=env, bufsize=1,
    )
    reverse.stdin.write(
        f"begin; set local statement_timeout='1500ms'; set local deadlock_timeout='100ms'; "
        f"select pg_advisory_xact_lock(hashtextextended('{reverse_owner}',912221));\\echo REVERSE_OWNER_HELD\n"
    )
    reverse.stdin.flush()
    while reverse.stdout.readline().strip() != "REVERSE_OWNER_HELD":
        pass
    maintenance = subprocess.Popen(
        base + ["-d", database, "-c", """
          select set_config('statement_timeout','1500ms',false);
          select set_config('deadlock_timeout','100ms',false);
          select public.run_capture_operational_maintenance(
            gen_random_uuid(),clock_timestamp(),clock_timestamp()+interval '55 seconds');
        """],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
    )
    time.sleep(0.1)
    reverse.stdin.write("delete from public.capture_external_work_admissions where admission_id='16161616-1616-4616-8616-161616161616'; commit;\\echo REVERSE_DONE\n\\q\n")
    reverse.stdin.flush()
    reverse_stdout, reverse_stderr = reverse.communicate(timeout=5)
    maintenance_stdout, maintenance_stderr = maintenance.communicate(timeout=5)
    assert reverse.returncode == 0, reverse_stderr
    assert maintenance.returncode == 0, maintenance_stderr
    assert "REVERSE_DONE" in reverse_stdout
    reverse_result = json.loads(maintenance_stdout.strip().splitlines()[-1])
    assert reverse_result["outcome"] == "completed"
    final_replay = json.loads(sql("select public.run_capture_operational_maintenance(gen_random_uuid(),clock_timestamp(),clock_timestamp()+interval '55 seconds');"))
    assert final_replay == {"outcome": "completed", "changedCount": 0}

    singleton_blocker = subprocess.Popen(
        base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, env=env, bufsize=1,
    )
    try:
        singleton_blocker.stdin.write(
            "begin; select 1 from public.capture_operational_maintenance where singleton for update;\\echo SINGLETON_HELD\n"
        )
        singleton_blocker.stdin.flush()
        while singleton_blocker.stdout.readline().strip() != "SINGLETON_HELD":
            pass
        singleton_output = sql("""
          select set_config('statement_timeout','750ms',false);
          select public.run_capture_operational_maintenance(
            gen_random_uuid(),clock_timestamp(),clock_timestamp()+interval '55 seconds');
        """)
        singleton_result = json.loads(singleton_output.splitlines()[-1])
        assert singleton_result == {"outcome": "contended"}
    finally:
        if singleton_blocker.poll() is None:
            singleton_blocker.stdin.write("rollback;\\q\n")
            singleton_blocker.stdin.flush()
            singleton_blocker.wait(timeout=5)

    blocker = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
    blocker.stdin.write("select pg_advisory_lock(hashtextextended('capture-operational-maintenance',9223));\n\\echo HELD\n")
    blocker.stdin.flush()
    while blocker.stdout.readline().strip() != "HELD":
        pass
    contended = json.loads(sql("select public.run_capture_operational_maintenance(gen_random_uuid(),clock_timestamp(),clock_timestamp()+interval '55 seconds');"))
    assert contended == {"outcome": "contended"}
    blocker.stdin.write("select pg_advisory_unlock(hashtextextended('capture-operational-maintenance',9223));\n\\q\n")
    blocker.stdin.flush()
    blocker.wait(timeout=5)

    report = json.loads(sql("select public.capture_operational_health();"))
    assert set(report) == {"overdueErasures","billingReconciliation","webhookDelivery","imagePressure","quotaPressure","readinessDrift","maintenance"}
    assert set(report.values()) <= {"ok","warning","critical","unknown"}
    assert report["overdueErasures"] == "critical"
    assert report["billingReconciliation"] == "critical"
    assert report["webhookDelivery"] == "unknown"
    assert report["readinessDrift"] == "ok"
    assert report["maintenance"] == "ok"
    assert "permission denied" in sql(
        "set role authenticated; select public.run_capture_operational_maintenance(gen_random_uuid(),clock_timestamp(),clock_timestamp()+interval '55 seconds');",
        ok=False,
    )
    evidence_denial = sql(
        f"set role service_role; delete from public.capture_account_erasure_evidence where operation_id='{operation}';",
        ok=False,
    )
    assert "permission denied" in evidence_denial or "immutable" in evidence_denial
    print("PASS: operational retention is bounded, locked, idempotent, evidence-preserving, and aggregate-only")
finally:
    sql(f"drop database if exists {database} with (force);", db="postgres")
