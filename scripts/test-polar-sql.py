"""Run only against a disposable local Unix-socket PostgreSQL cluster.
Usage: python3 scripts/test-polar-sql.py /absolute/socket/directory 55439
Creates/drops its own random database. Never reads application env or connects TCP.
"""
import pathlib
import subprocess
import sys
import uuid

socket = pathlib.Path(sys.argv[1])
port = sys.argv[2]
if not socket.is_absolute() or not (socket / f".s.PGSQL.{port}").is_socket():
    raise SystemExit("An existing absolute local PostgreSQL socket directory is required")
root = pathlib.Path(__file__).resolve().parents[1]
database = "capture_billing_test_" + uuid.uuid4().hex
base = ["psql", "-X", "-h", str(socket), "-p", port, "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At"]


def sql(query, db=database, ok=True):
    result = subprocess.run(base + ["-d", db], input=query, text=True, capture_output=True,
                            env={"PATH": "/opt/homebrew/bin:/usr/bin:/bin", "LC_ALL": "C"})
    if ok and result.returncode:
        raise AssertionError(result.stderr)
    if not ok:
        assert result.returncode, "Expected database rejection"
        return result.stderr
    return result.stdout.strip()


owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
missing = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"


def event(eid, sub="sub_1", user=owner, status="active", timestamp="2026-09-13", customer="cus_1"):
    # All arguments are fixed synthetic fixtures from this script, not external input.
    return f"""select public.apply_polar_subscription_event(
      '{eid}', 'subscription.{status}', '{timestamp}', '{user}', '{status}', 'monthly',
      {'false' if status == 'revoked' else 'true'}, '{customer}', '{sub}', 'product_1',
      '2026-09-01', '2026-10-01', '2026-10-01', false);"""


sql(f"create database {database};", db="postgres")
try:
    sql("""do $$ begin
      if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select from pg_roles where rolname='service_role') then create role service_role; end if;
    end $$;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as
      'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    grant usage on schema auth, public to authenticated, anon, service_role;
    """)
    for name in ["20260911170000_polar_entitlements.sql", "20260912162000_polar_event_ordering.sql"]:
        sql((root / "supabase/migrations" / name).read_text())
    sql(f"insert into auth.users values ('{owner}'), ('{other}');")
    assert "foreign key constraint" in sql(event("orphan_before", user=missing), ok=False)
    assert sql("select count(*) from public.polar_webhook_events") == "0"
    print("BASELINE: missing auth user raises FK violation; transaction rolls back")
    assert sql(event("tie_active", sub="tie_a")) == "t"
    assert sql(event("tie_revoked", sub="tie_a", status="revoked")) == "t"
    assert sql(event("tie_revoked_first", sub="tie_b", status="revoked")) == "t"
    assert sql(event("tie_active_second", sub="tie_b")) == "t"
    assert sql("select string_agg(status, ',' order by polar_subscription_id) from public.capture_cloud_subscriptions") == "active,revoked"
    print("BASELINE: contradictory equal timestamps produce active/revoked by arrival order (UNRESOLVED)")
    amendment = root / "supabase/migrations/20260913190000_polar_missing_user.sql"
    if amendment.exists():
        sql(amendment.read_text())
    # Regression: acknowledge unresolvable identities, but durably deduplicate them.
    assert sql(event("orphan_after", user=missing)) == "f"
    assert sql(event("orphan_after", user=missing)) == "f"
    assert sql("select count(*) from public.polar_webhook_events where event_id='orphan_after' and user_id is null") == "1"
    assert sql("select count(*) from public.capture_cloud_subscriptions where polar_subscription_id='sub_1'") == "0"
    print("PASS: missing user acknowledged, ledger retained, no access, duplicate safe")
    assert sql(event("first")) == "t"
    assert sql(event("first")) == "f"
    assert sql(event("old", status="revoked", timestamp="2026-09-12")) == "t"
    assert sql("select status from public.capture_cloud_subscriptions where polar_subscription_id='sub_1'") == "active"
    assert "ownership mismatch" in sql(event("wrong_owner", user=other), ok=False)
    assert "ownership mismatch" in sql(event("wrong_customer", customer="cus_other"), ok=False)
    assert sql("select count(*) from public.polar_webhook_events where event_id in ('wrong_owner','wrong_customer')") == "0"
    print("PASS: deduplication, stale delivery, ownership/customer mismatch and rollback")
    assert "permission denied" in sql("set role authenticated; " + event("forbidden"), ok=False)
    assert "permission denied" in sql("set role anon; " + event("forbidden_anon"), ok=False)
    assert "permission denied" in sql("set role authenticated; update public.capture_cloud_subscriptions set is_entitled=true", ok=False)
    assert sql("set role service_role; " + event("service_call", sub="sub_2", user=other)) == "SET\nt"
    visible = sql(f"set role authenticated; set request.jwt.claim.sub='{other}'; select string_agg(polar_subscription_id, ',') from public.capture_cloud_subscriptions;")
    assert visible == "SET\nSET\nsub_2", visible
    print("PASS: service-only RPC, authenticated write denied, cross-owner RLS")
    sql(event("legacy_past_due", sub="legacy_past_due", status="past_due"))
    reconciliation = root / "supabase/migrations/20260913200000_polar_reconciliation.sql"
    if reconciliation.exists():
        sql(reconciliation.read_text())
    review = root / "supabase/migrations/20260913210000_polar_review_guards.sql"
    if review.exists():
        sql(review.read_text())
    # The amendment must also repair ambiguity already acknowledged by the old code.
    assert sql("select bool_and(reconciliation_required and not is_entitled) from public.capture_cloud_subscriptions where polar_subscription_id in ('tie_a','tie_b')") == "t"
    assert sql("select reconciliation_required and not is_entitled from public.capture_cloud_subscriptions where polar_subscription_id='legacy_past_due'") == "t"
    sql("delete from public.capture_cloud_subscriptions where polar_subscription_id in ('tie_a','tie_b','legacy_past_due')")
    # RED before amendment: opposite arrival orders must both stop granting until GET reconciles.
    sql(event("conflict_active", sub="conflict_a"))
    sql(event("conflict_revoked", sub="conflict_a", status="revoked"))
    sql(event("conflict_revoked_first", sub="conflict_b", status="revoked"))
    sql(event("conflict_active_second", sub="conflict_b"))
    assert sql("select bool_or(is_entitled) from public.capture_cloud_subscriptions where polar_subscription_id like 'conflict_%'") == "f", "equal timestamps still grant by arrival order"
    print("PASS: both arrival orders deny pending authoritative reconciliation")
    import json
    def claim(sub):
        return json.loads(sql(f"select public.claim_polar_reconciliation('{sub}');"))
    def finish(sub, version, **overrides):
        snapshot = dict(userId=owner, polarSubscriptionId=sub, polarCustomerId="cus_1", polarProductId="product_1",
                        status="canceled", plan="monthly", isEntitled=True, cancelAtPeriodEnd=True,
                        currentPeriodStart="2026-09-01", currentPeriodEnd="2026-10-01", accessExpiresAt="2026-10-01")
        snapshot.update(overrides)
        return f"select public.finish_polar_reconciliation('{sub}', {version}, '{json.dumps(snapshot)}'::jsonb);"
    ticket = claim("conflict_a")
    assert ticket["pending"] and ticket["version"]
    assert claim("conflict_a") == {"pending": True}, "concurrent retry should be throttled"
    assert sql(event("conflict_revoked", sub="conflict_a", status="revoked")) == "f"
    assert sql("select reconciliation_required from public.capture_cloud_subscriptions where polar_subscription_id='conflict_a'") == "t"
    # A newer webhook arriving during a fetch fences the old result, even if it grants access.
    sql(event("newer_during_fetch", sub="conflict_a", status="revoked", timestamp="2026-09-14"))
    assert sql(finish("conflict_a", ticket["version"])) == "f"
    assert sql("select is_entitled from public.capture_cloud_subscriptions where polar_subscription_id='conflict_a'") == "f"
    ticket = claim("conflict_a")
    assert "binding mismatch" in sql(finish("conflict_a", ticket["version"], polarCustomerId="wrong"), ok=False)
    assert sql(finish("conflict_a", ticket["version"], polarProductId="product_2", plan="yearly")) == "t"
    assert sql("select polar_product_id from public.capture_cloud_subscriptions where polar_subscription_id='conflict_a'") == "product_2"
    assert sql(finish("conflict_a", ticket["version"], isEntitled=False)) == "f"
    assert claim("conflict_a") == {"pending": False}
    assert sql("select is_entitled and cancel_at_period_end and not reconciliation_required from public.capture_cloud_subscriptions where polar_subscription_id='conflict_a'") == "t"
    # A worker crash leaves a durable retry; expiry of the short claim timeout allows recovery.
    crashed = claim("conflict_b")
    sql("update public.capture_cloud_subscriptions set reconcile_after='-infinity' where polar_subscription_id='conflict_b'")
    retry = claim("conflict_b")
    assert retry["version"] != crashed["version"]
    assert sql(finish("conflict_b", crashed["version"])) == "f"
    assert sql(finish("conflict_b", retry["version"], status="revoked", isEntitled=False)) == "t"
    for role in ["anon", "authenticated"]:
        assert "permission denied" in sql(f"set role {role}; select public.claim_polar_reconciliation('conflict_a');", ok=False)
        assert "permission denied" in sql(f"set role {role}; " + finish("conflict_a", 1), ok=False)
    print("PASS: durable retry, duplicate retry, claim throttling, version fences, binding, scheduled cancellation, RPC grants")
    # Delayed events generated before a GET can arrive after it. Once ambiguous,
    # keep using authoritative GET instead of trusting a newer envelope timestamp.
    sql(event("delayed_after_get", sub="conflict_a", timestamp="2026-09-15"))
    assert sql("select reconciliation_required and not is_entitled from public.capture_cloud_subscriptions where polar_subscription_id='conflict_a'") == "t"
    assert sql(f"set role service_role; select public.next_polar_reconciliation('{owner}');") == "SET\nconflict_a"
    assert sql(f"select public.next_polar_reconciliation('{other}');") == ""
    ticket = claim("conflict_a")
    assert sql(f"select public.next_polar_reconciliation('{owner}');") == "", "leased job must not crowd out due work"
    assert sql(finish("conflict_a", ticket["version"], isEntitled=False, status="revoked")) == "t"
    assert "permission denied" in sql(f"set role authenticated; select public.next_polar_reconciliation('{owner}');", ok=False)
    print("PASS: post-fetch delayed events reconcile again; bounded owner-only due queue")
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    def concurrent_queries(queries):
        barrier = Barrier(len(queries))
        def invoke(query):
            barrier.wait()
            return subprocess.run(base + ["-d", database], input=query, text=True, capture_output=True,
                                  env={"PATH": "/opt/homebrew/bin:/usr/bin:/bin", "LC_ALL": "C"})
        with ThreadPoolExecutor(max_workers=len(queries)) as pool:
            return list(pool.map(invoke, queries))
    for i, statuses in enumerate([("active", "revoked"), ("revoked", "active")]):
        sub = f"concurrent_{i}"
        results = concurrent_queries(["begin; " + event(f"parallel_{i}_{status}", sub=sub, status=status) + " select pg_sleep(0.1); commit;" for status in statuses])
        assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
        assert sql(f"select reconciliation_required and not is_entitled from public.capture_cloud_subscriptions where polar_subscription_id='{sub}'") == "t"
        claims = concurrent_queries([f"select public.claim_polar_reconciliation('{sub}');"] * 2)
        tickets = [json.loads(r.stdout) for r in claims]
        assert sum("version" in t for t in tickets) == 1
        t = next(t for t in tickets if "version" in t)
        assert sql("set role service_role; " + finish(sub, t["version"], status="revoked", isEntitled=False)) == "SET\nt"
    assert sql("select bool_and(status='revoked' and not is_entitled and not reconciliation_required) from public.capture_cloud_subscriptions where polar_subscription_id like 'concurrent_%'") == "t"
    races = concurrent_queries(["begin; " + event(f"owner_race_{i}", sub="owner_race", user=u) + " select pg_sleep(0.1); commit;" for i, u in enumerate([owner, other])])
    assert all(r.returncode == 0 for r in races), [r.stderr for r in races]
    assert sql("select reconciliation_required and not is_entitled from public.capture_cloud_subscriptions where polar_subscription_id='owner_race'") == "t"
    assert sql("select count(distinct user_id) from public.polar_webhook_events where polar_subscription_id='owner_race'") == "1"
    assert sql("select count(*) from public.polar_webhook_events where polar_subscription_id='owner_race'") == "2"
    assert "permission denied" in sql("set role service_role; " + event("base_bypass").replace("apply_polar_subscription_event(", "apply_polar_subscription_event_base("), ok=False)
    print("PASS: real concurrent equal events and claims, convergent provider result, first-insert owner race, no base RPC bypass")
    # A syntactically valid but changed identity must deny the tracked source,
    # not throw/roll back and leave its former entitlement enabled.
    sql(event("bound_seed", sub="bound_transition"))
    assert sql(event("bound_change", sub="bound_transition", user=other, timestamp="2026-09-14")) == "t"
    assert sql(f"select user_id='{owner}' and polar_customer_id='cus_1' and reconciliation_required and not is_entitled from public.capture_cloud_subscriptions where polar_subscription_id='bound_transition'") == "t"
    print("PASS: normalized binding transition queues denial without ownership transfer")
    def invalid(eid, sub="invalid_tracked", timestamp="2026-09-14"):
        return f"select public.queue_invalid_polar_event('{sub}', '{eid}', 'subscription.canceled', '{timestamp}');"
    sql(event("invalid_seed", sub="invalid_tracked"))
    sql(event("unaffected_seed", sub="unaffected"))
    assert sql(invalid("unrelated", sub="unrelated")) == "f"
    assert sql("select count(*) from public.polar_webhook_events where event_id='unrelated'") == "0"
    assert sql(invalid("stale_invalid", timestamp="2026-09-12")) == "t"
    assert sql("select is_entitled and not reconciliation_required from public.capture_cloud_subscriptions where polar_subscription_id='invalid_tracked'") == "t"
    assert sql("set role service_role; " + invalid("invalid_terminal")) == "SET\nt"
    assert sql(f"select user_id='{owner}' and polar_customer_id='cus_1' and polar_product_id='product_1' and reconciliation_required and not is_entitled from public.capture_cloud_subscriptions where polar_subscription_id='invalid_tracked'") == "t"
    ticket = claim("invalid_tracked")
    assert sql(invalid("invalid_terminal")) == "t"
    assert claim("invalid_tracked") == {"pending": True}
    assert sql(f"select state_version={ticket['version']} from public.capture_cloud_subscriptions where polar_subscription_id='invalid_tracked'") == "t"
    assert sql(invalid("invalid_newer", timestamp="2026-09-15")) == "t"
    assert sql(finish("invalid_tracked", ticket["version"])) == "f"
    repaired = claim("invalid_tracked")
    assert sql(finish("invalid_tracked", repaired["version"], status="revoked", isEntitled=False)) == "t"
    assert sql(invalid("invalid_newer", timestamp="2026-09-15")) == "t"
    assert claim("invalid_tracked") == {"pending": False}
    assert sql("select is_entitled and not reconciliation_required from public.capture_cloud_subscriptions where polar_subscription_id='unaffected'") == "t"
    for role in ["anon", "authenticated"]:
        assert "permission denied" in sql(f"set role {role}; " + invalid("forbidden_invalid"), ok=False)
    assert "permission denied" in sql("set role service_role; select public.lock_polar_parent('invalid_tracked');", ok=False)
    print("PASS: tracked invalid deny/queue, unrelated ignore, stale/duplicate leases, fence, repair, other source, grants")
    # Independent deterministic delete race: hold the auth parent, wait until
    # each RPC is actually blocked, then cascade. No scheduler/sleep ordering.
    import time
    for operation in ["apply", "apply_other", "claim", "finish", "invalid"]:
        race_owner = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        sub = "delete_" + operation
        sql(f"insert into auth.users values ('{race_owner}');")
        sql(event("seed_" + sub, sub=sub, user=race_owner))
        sql(f"update public.capture_cloud_subscriptions set reconciliation_required=true where polar_subscription_id='{sub}';")
        if operation in ("apply", "apply_other"):
            query = event("race_" + sub, sub=sub, user=other if operation == "apply_other" else race_owner, timestamp="2026-09-14")
        elif operation == "claim":
            query = f"select public.claim_polar_reconciliation('{sub}');"
        elif operation == "finish":
            query = finish(sub, 1, userId=race_owner)
        else:
            query = f"select public.queue_invalid_polar_event('{sub}', 'invalid_delete', 'subscription.canceled', '2026-09-14');"
        process_env = {"PATH": "/opt/homebrew/bin:/usr/bin:/bin", "LC_ALL": "C"}
        deleter = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=process_env)
        assert deleter.stdin is not None and deleter.stdout is not None
        deleter.stdin.write(f"begin; set statement_timeout='5s'; select 1 from auth.users where id='{race_owner}' for update;\n")
        deleter.stdin.flush()
        # psql stdout is flushed per result; confirms the parent is locked.
        assert deleter.stdout.readline().strip() == "BEGIN"
        assert deleter.stdout.readline().strip() == "SET"
        assert deleter.stdout.readline().strip() == "1"
        worker = subprocess.Popen(base + ["-d", database], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=process_env)
        assert worker.stdin is not None
        worker.stdin.write("set application_name='billing_delete_race'; set statement_timeout='5s'; " + query + "\n")
        worker.stdin.flush()
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if sql("select count(*) from pg_stat_activity where application_name='billing_delete_race' and wait_event_type='Lock'") == "1":
                break
            time.sleep(0.02)
        else:
            worker.kill(); deleter.kill()
            worker.communicate(); deleter.communicate()
            raise AssertionError(operation + " did not acquire parent lock first")
        out, err = deleter.communicate(f"delete from auth.users where id='{race_owner}'; commit;", timeout=8)
        worker_out, worker_err = worker.communicate(timeout=8)
        assert deleter.returncode == 0 and worker.returncode == 0, (operation, err, worker_err)
        assert sql(f"select count(*) from public.capture_cloud_subscriptions where polar_subscription_id='{sub}'") == "0"
    print("PASS: independent bounded parent-delete races across apply/claim/finish/invalid RPCs")
finally:
    sql(f"drop database {database};", db="postgres")
