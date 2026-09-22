"""Run durable Cloud owner-quota checks against a disposable local PostgreSQL socket.
Usage: python3 scripts/test-cloud-quota-sql.py /absolute/socket/directory 55442
Creates/drops a random database and never reads application environment variables.
"""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import json
import pathlib
import subprocess
import sys
import uuid

socket = pathlib.Path(sys.argv[1])
port = sys.argv[2]
if not socket.is_absolute() or not (socket / f".s.PGSQL.{port}").is_socket():
    raise SystemExit("An existing absolute local PostgreSQL socket directory is required")

root = pathlib.Path(__file__).resolve().parents[1]
database = "capture_quota_test_" + uuid.uuid4().hex
process_env = {"PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "LC_ALL": "C"}
base = ["psql", "-X", "-h", str(socket), "-p", port, "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At"]


def sql(query, db=database, ok=True):
    result = subprocess.run(base + ["-d", db], input=query, text=True, capture_output=True, env=process_env)
    if ok and result.returncode:
        raise AssertionError(result.stderr)
    if not ok:
        assert result.returncode, "Expected database rejection"
        return result.stderr
    return result.stdout.strip()


owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


def quota_query(user, scope="managed_ai"):
    return (
        "set role authenticated; "
        f"set request.jwt.claim.sub='{user}'; "
        f"select public.consume_capture_cloud_quota('{scope}');"
    )


def quota_result(output):
    return json.loads(output.splitlines()[-1])


def concurrent_queries(queries):
    barrier = Barrier(len(queries))

    def invoke(query):
        barrier.wait()
        return subprocess.run(base + ["-d", database], input=query, text=True,
                              capture_output=True, env=process_env)

    with ThreadPoolExecutor(max_workers=len(queries)) as pool:
        return list(pool.map(invoke, queries))


sql(f"create database {database};", db="postgres")
try:
    sql("""do $$ begin
      if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select from pg_roles where rolname='service_role') then create role service_role; end if;
    end $$;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    grant usage on schema auth, public to authenticated, anon, service_role;
    create function public.consume_capture_cloud_quota(text, integer, integer)
      returns jsonb language sql security definer set search_path=''
      as 'select jsonb_build_object(''allowed'', true, ''retryAfterSec'', 0)';
    grant execute on function public.consume_capture_cloud_quota(text, integer, integer)
      to authenticated;
    """)
    sql((root / "supabase/migrations/20260921200000_cloud_owner_quotas.sql").read_text())
    sql(f"insert into auth.users values ('{owner}'), ('{other}');")

    signatures = sql("""select pg_catalog.pg_get_function_identity_arguments(p.oid)
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='consume_capture_cloud_quota'
      order by 1""")
    assert signatures == "p_scope text", signatures
    print("PASS: upgrade removes the legacy caller-controlled quota overload")

    assert "permission denied" in sql("set role authenticated; select * from public.capture_cloud_owner_quotas;", ok=False)
    assert "permission denied" in sql("set role authenticated; select * from public.capture_cloud_quota_policies;", ok=False)
    assert "permission denied" in sql("set role anon; select public.consume_capture_cloud_quota('managed_ai');", ok=False)
    assert "authenticated owner required" in sql("set role authenticated; select public.consume_capture_cloud_quota('managed_ai');", ok=False)
    print("PASS: no direct counter access, anonymous and missing-owner calls fail closed")

    attempts = 40
    limit = 12
    sql(f"update public.capture_cloud_quota_policies set request_limit={limit}, window_seconds=3600 where scope='managed_ai';")
    results = concurrent_queries([quota_query(owner)] * attempts)
    assert all(result.returncode == 0 for result in results), [result.stderr for result in results]
    parsed = [quota_result(result.stdout) for result in results]
    assert sum(result["allowed"] for result in parsed) == limit, parsed
    assert sum(not result["allowed"] for result in parsed) == attempts - limit, parsed
    assert all(result["retryAfterSec"] > 0 for result in parsed if not result["allowed"])
    assert sql(f"select request_count from public.capture_cloud_owner_quotas where user_id='{owner}' and scope='managed_ai'") == str(limit)
    print("PASS: concurrent requests atomically admit exactly the owner limit")

    sql("update public.capture_cloud_quota_policies set request_limit=3 where scope='managed_ai';")
    other_results = concurrent_queries([quota_query(other)] * 5)
    assert sum(quota_result(result.stdout)["allowed"] for result in other_results) == 3
    sql("update public.capture_cloud_quota_policies set request_limit=1 where scope in ('board_read', 'board_write', 'backup_read');")
    assert quota_result(sql(quota_query(owner, scope="board_read")))["allowed"]
    assert quota_result(sql(quota_query(owner, scope="board_write")))["allowed"]
    assert quota_result(sql(quota_query(owner, scope="backup_read")))["allowed"]
    assert not quota_result(sql(quota_query(owner, scope="board_read")))["allowed"]
    print("PASS: owners and AI/read/write/backup scopes are isolated")

    policy_error = sql(
        "set role authenticated; set request.jwt.claim.sub='" + owner + "'; "
        "update public.capture_cloud_quota_policies set request_limit=1000000, window_seconds=1 "
        "where scope='managed_ai';",
        ok=False,
    )
    assert "permission denied" in policy_error
    argument_error = sql(
        "set role authenticated; set request.jwt.claim.sub='" + owner + "'; "
        "select public.consume_capture_cloud_quota('managed_ai', 1000000, 1);",
        ok=False,
    )
    assert "does not exist" in argument_error
    assert sql("select request_limit || ':' || window_seconds from public.capture_cloud_quota_policies where scope='managed_ai'") == "3:3600"
    print("PASS: browser-authenticated callers cannot substitute or reset quota policy")

    sql(f"update public.capture_cloud_owner_quotas set window_started_at=clock_timestamp()-interval '2 hours' where user_id='{owner}' and scope='managed_ai';")
    sql("update public.capture_cloud_quota_policies set request_limit=1, window_seconds=3600 where scope='managed_ai';")
    reset = quota_result(sql(quota_query(owner)))
    assert reset == {"allowed": True, "retryAfterSec": 0}, reset
    assert sql(f"select request_count from public.capture_cloud_owner_quotas where user_id='{owner}' and scope='managed_ai'") == "1"
    print("PASS: expired windows reset atomically instead of accumulating forever")

    assert "invalid quota scope" in sql(quota_query(owner, scope="unknown"), ok=False)
    assert sql("select count(*) from public.capture_cloud_owner_quotas") == "5"
    print("PASS: PostgreSQL validates scopes without mutating counters")
finally:
    sql(f"drop database {database};", db="postgres")
