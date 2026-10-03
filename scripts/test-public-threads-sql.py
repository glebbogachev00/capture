"""Disposable socket-only PostgreSQL test for public Thread snapshots.
Synthetic rows only; no app env, no remote database. Exercises the real
migration's RLS, grants, trigger and anonymous read function.
"""
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
ENV = {"PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "LC_ALL": "C"}
A = '00000000-0000-4000-8000-000000000001'
B = '00000000-0000-4000-8000-000000000002'
KEY = 'a' * 64
TOKEN = 'does-the-product-earn-the-story-abcdefghijklmnop'
MIGRATION = ROOT / 'supabase/migrations/20261003120000_capture_public_threads.sql'
PORT = '55439'

with tempfile.TemporaryDirectory(prefix='capture-public-pg-', dir='/tmp') as d:
    def command(*args):
        return subprocess.run(args, env=ENV, check=True, capture_output=True, text=True)
    command('initdb', '-D', d + '/data', '-U', 'postgres', '--auth=trust', '--no-locale')
    started = False
    try:
        command('pg_ctl', '-D', d + '/data', '-l', d + '/postgres.log', '-o', f"-k {d} -p {PORT} -c listen_addresses=''", '-w', 'start')
        started = True
        args = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', d, '-p', PORT, '-U', 'postgres', '-d', 'postgres']
        def sql(text):
            return subprocess.run(args + ['-c', text], env=ENV, capture_output=True, text=True)
        def ok(text):
            r = sql(text)
            assert r.returncode == 0, r.stderr
            return r.stdout.strip()
        def denied(text, reason=None):
            r = sql(text)
            assert r.returncode != 0, f'expected refusal: {text}'
            if reason:
                assert reason in r.stderr, r.stderr
        def as_user(owner, text):
            return f"set role authenticated; set request.jwt.claim.sub = '{owner}'; {text}"
        def as_anon(text):
            return f"set role anon; set request.jwt.claim.sub = ''; {text}"
        def fragments(*texts):
            return "'[" + ",".join('{"text":"%s"}' % t for t in texts) + "]'::jsonb"

        # Stand-ins for Supabase roles/auth and the account-erasure helpers the
        # migration relies on (same contracts as 20260922100000).
        ok(f"""create role anon; create role authenticated; create role service_role;
        create schema auth; create table auth.users(id uuid primary key);
        insert into auth.users values ('{A}'),('{B}');
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
        grant usage on schema auth to authenticated, anon;
        grant usage on schema public to authenticated, anon;
        create table public.capture_account_erasure_operations(owner_id uuid, stage text);
        create function public.capture_account_write_allowed(p_user_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
          declare v_stage text; begin
            if p_user_id is null then return false; end if;
            if auth.uid() is not null and auth.uid() is distinct from p_user_id then raise insufficient_privilege using message='exact owner required'; end if;
            select stage into v_stage from public.capture_account_erasure_operations where owner_id=p_user_id and stage<>'complete';
            if not found then return true; end if; return v_stage='prepared'; end $$;
        create function public.capture_account_read_allowed(p_user_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
          declare v_stage text; begin
            if p_user_id is null then return false; end if;
            if auth.uid() is not null and auth.uid() is distinct from p_user_id then raise insufficient_privilege using message='exact owner required'; end if;
            select stage into v_stage from public.capture_account_erasure_operations where owner_id=p_user_id and stage<>'complete';
            if not found then return true; end if; return v_stage='prepared'; end $$;
        revoke all on function public.capture_account_write_allowed(uuid), public.capture_account_read_allowed(uuid) from public, anon;
        grant execute on function public.capture_account_write_allowed(uuid), public.capture_account_read_allowed(uuid) to authenticated;
        """)
        ok(MIGRATION.read_text())
        ok(MIGRATION.read_text())  # re-runnable

        def insert(owner, token=TOKEN):
            return f"""insert into public.capture_public_threads(owner_id, token, source_key, title, intro, byline, fragments)
            values ('{owner}', '{token}', '{KEY}', 'Does the product earn the story?', 'Intro', 'Gleb', {fragments('The source', 'Try it')})"""

        # Owners write only their own rows.
        ok(as_user(A, insert(A)))
        denied(as_user(A, insert(B, 'stolen-abcdefghijklmnop')), 'row-level security')
        denied(as_user(B, f"select public.capture_account_write_allowed('{A}')"), 'exact owner required')
        assert ok(as_user(B, 'select count(*) from public.capture_public_threads')) == '0'
        assert ok(as_user(B, f"update public.capture_public_threads set title='defaced' where token='{TOKEN}' returning 1")) == ''
        assert ok(as_user(B, f"delete from public.capture_public_threads where token='{TOKEN}' returning 1")) == ''
        assert ok(as_user(A, 'select title from public.capture_public_threads')) == 'Does the product earn the story?'

        # Anonymous: no table access; one snapshot by exact token, public columns only.
        denied(as_anon('select * from public.capture_public_threads'), 'permission denied')
        denied(as_anon('select owner_id from public.capture_public_threads'), 'permission denied')
        row = ok(as_anon(f"select title, intro, byline, fragments->1->>'text' from public.capture_public_thread('{TOKEN}')"))
        assert row == 'Does the product earn the story?|Intro|Gleb|Try it', row
        out_columns = ok("select string_agg(name, ',') from (select unnest(proargnames) name from pg_proc where proname='capture_public_thread') n where name <> 'p_token'")
        assert out_columns == 'token,title,intro,byline,fragments,published_at,updated_at', out_columns
        assert 'owner' not in out_columns and 'source' not in out_columns
        assert ok(as_anon("select count(*) from public.capture_public_thread('does-the-product-earn-the-story-zzzzzzzzzzzzzzzz')")) == '0'
        assert ok(as_anon("select count(*) from public.capture_public_thread(null)")) == '0'
        assert ok(as_anon("select count(*) from public.capture_public_thread('%')")) == '0'
        # A signed-in stranger reads a public snapshot like anyone else, no more.
        assert ok(as_user(B, f"select title from public.capture_public_thread('{TOKEN}')")) == 'Does the product earn the story?'

        # Explicit update changes content and updated_at; identity fields are fixed.
        before = ok(f"select updated_at from public.capture_public_threads where token='{TOKEN}'")
        ok(as_user(A, f"update public.capture_public_threads set title='Updated', fragments={fragments('Only this')} where token='{TOKEN}'"))
        assert ok(as_anon(f"select title, fragments->0->>'text', jsonb_array_length(fragments) from public.capture_public_thread('{TOKEN}')")) == 'Updated|Only this|1'
        assert ok(f"select updated_at > '{before}'::timestamptz from public.capture_public_threads where token='{TOKEN}'") == 't'
        denied(as_user(A, f"update public.capture_public_threads set token='other-abcdefghijklmnop' where token='{TOKEN}'"), 'fixed')
        denied(as_user(A, f"update public.capture_public_threads set source_key='{'b' * 64}' where token='{TOKEN}'"), 'fixed')
        denied(as_user(A, f"update public.capture_public_threads set owner_id='{B}' where token='{TOKEN}'"))

        # Shape limits.
        denied(as_user(A, insert(A, 'Bad Token!')), 'token_shape')
        denied(as_user(A, insert(A, 'empty-abcdefghijklmnop').replace(fragments('The source', 'Try it'), "'[]'::jsonb")), 'fragments_array')
        denied(as_user(A, insert(A, 'object-abcdefghijklmnop').replace(fragments('The source', 'Try it'), "'{}'::jsonb")), 'fragments_array')
        denied(as_user(A, insert(A, 'dup-' + TOKEN[-16:]).replace(f"'{KEY}'", "'not-a-hash'")), 'source_key_shape')

        # An account being erased stops serving and stops writing.
        ok(f"insert into public.capture_account_erasure_operations values ('{A}', 'confirmed')")
        assert ok(as_anon(f"select count(*) from public.capture_public_thread('{TOKEN}')")) == '0'
        denied(as_user(A, insert(A, 'late-abcdefghijklmnop')), 'row-level security')
        assert ok(as_user(A, 'select count(*) from public.capture_public_threads')) == '0'
        ok(f"delete from public.capture_account_erasure_operations where owner_id='{A}'")
        assert ok(as_anon(f"select count(*) from public.capture_public_thread('{TOKEN}')")) == '1'

        # Unpublish removes it from the only public read.
        assert ok(as_user(A, f"delete from public.capture_public_threads where token='{TOKEN}' returning 1")) == '1'
        assert ok(as_anon(f"select count(*) from public.capture_public_thread('{TOKEN}')")) == '0'

        # Deleting the account deletes its snapshots.
        ok(as_user(A, insert(A, 'again-abcdefghijklmnop')))
        ok(f"delete from auth.users where id='{A}'")
        assert ok('select count(*) from public.capture_public_threads') == '0'
        print('public threads SQL: all checks passed')
    finally:
        if started:
            command('pg_ctl', '-D', d + '/data', '-m', 'immediate', 'stop')
