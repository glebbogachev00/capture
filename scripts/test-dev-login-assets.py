"""Read-only regression for local login hydration; never submits credentials.

Run against an already-running sandbox: python3 scripts/test-dev-login-assets.py
Next's origin guard must allow loopback script requests but deny other sites.
"""
import re
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:4998"


def get(path, origin=None):
    request = urllib.request.Request(
        BASE + path, headers={"Origin": origin} if origin else {}
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read()


status, _, html = get("/login")
assert status == 200, f"Login returned {status}"
scripts = re.findall(r'<script[^>]+src="([^"]+)"', html.decode())
assert scripts, "Login has no scripts"
for path in scripts:
    assert path.startswith("/_next/"), "Unexpected external script"
    status, headers, body = get(path, BASE)
    assert status == 200, f"Loopback script blocked: {status} {path}"
    assert "javascript" in headers.get("Content-Type", ""), path
    assert not body.lstrip().startswith(b"<"), f"HTML instead of JS: {path}"
status, _, _ = get(scripts[0], "https://untrusted.example.invalid")
assert status == 403, f"Untrusted origin must remain blocked, got {status}"
print(f"PASS: {len(scripts)} loopback JS assets load; untrusted origin denied; no OTP sent")
