"""Boot an isolated socket-only PostgreSQL cluster for operational retention tests."""
import pathlib
import subprocess
import sys
import tempfile

env = {"PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "LC_ALL": "C"}
root = pathlib.Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix="capture-retention-pg-", dir="/tmp") as directory:
    data = str(pathlib.Path(directory) / "data")

    def run(*args):
        return subprocess.run(args, env=env, check=True)

    run("initdb", "-D", data, "-U", "postgres", "--auth=trust", "--no-locale")
    started = False
    try:
        run("pg_ctl", "-D", data, "-l", directory + "/postgres.log", "-o",
            f"-k {directory} -p 55443 -c listen_addresses=''", "-w", "start")
        started = True
        run(sys.executable, str(root / "test-operational-retention-sql.py"), directory, "55443")
    finally:
        if started:
            run("pg_ctl", "-D", data, "-m", "immediate", "-w", "stop")
