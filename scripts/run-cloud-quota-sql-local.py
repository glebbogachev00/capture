"""Boot an isolated PostgreSQL cluster, exercise Cloud owner quotas, then remove it.
No environment files, application credentials, remote databases, or TCP listeners.
Usage: python3 scripts/run-cloud-quota-sql-local.py
Requires installed initdb, pg_ctl, and psql.
"""
import pathlib
import subprocess
import sys
import tempfile

env = {"PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "LC_ALL": "C"}
root = pathlib.Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix="capture-quota-pg-", dir="/tmp") as directory:
    data = str(pathlib.Path(directory) / "data")

    def run(*args):
        return subprocess.run(args, env=env, check=True)

    run("initdb", "-D", data, "-U", "postgres", "--auth=trust", "--no-locale")
    started = False
    try:
        run("pg_ctl", "-D", data, "-l", directory + "/postgres.log", "-o",
            f"-k {directory} -p 55442 -c listen_addresses=''", "-w", "start")
        started = True
        run(sys.executable, str(root / "test-cloud-quota-sql.py"), directory, "55442")
    finally:
        if started:
            run("pg_ctl", "-D", data, "-m", "immediate", "-w", "stop")
