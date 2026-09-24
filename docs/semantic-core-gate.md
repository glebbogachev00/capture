# Semantic core gate

This gate runs the small release-critical Sort pack against one identified build. It is intentionally separate from product routing and provider code.

## Run

Localhost (default):

```sh
npm run --silent gate:semantic-core
```

Authorized disposable Vercel Preview:

```sh
npm run --silent gate:semantic-core -- \
  --target https://capture-git-branch-team.vercel.app \
  --allow-remote
```

The remote opt-in is mandatory. The target must be an HTTPS Vercel Preview-shaped `*.vercel.app` host. Production aliases, custom domains, URL credentials, paths, queries, and fragments are rejected. Loopback targets are limited to `localhost`, `127.0.0.1`, and `[::1]`.

If the target already requires an authenticated session, supply the complete Cookie header in the process environment:

```sh
CAPTURE_SEMANTIC_GATE_COOKIE='session_name=value' npm run --silent gate:semantic-core -- \
  --target https://capture-git-branch-team.vercel.app \
  --allow-remote
```

The gate does not read `.env` files, log the Cookie value, or persist it. Do not pass secrets in command-line arguments.

Use `--artifact <path>` to override the default `outputs/semantic-core-gate.json`.

## Contract

The command:

1. reads `/api/version` before spending model quota;
2. resolves the named `release-critical` pack from `src/lib/sortCases.json` plus the exact four-action regression;
3. posts one case at a time through the flat `{ raw, threads, localDate, timeZone }` request helper;
4. retries one HTTP 429, honoring `Retry-After` up to 10 seconds;
5. continues after semantic failures, but stops after infrastructure, provider, or quota failure;
6. writes a mode-`0600` JSON artifact atomically and emits the same data as compact JSON on stdout.

The artifact stores case IDs, source-case IDs, SHA-256 input hashes, structural observations, provider `via`, exact reason codes, totals, build identity, and timing. It never stores raw case text, model prose, HTTP error text, or cookies.

Overall statuses and exit codes:

- `pass` — exit `0`
- `semantic_failure` — exit `1`
- `inconclusive` (infrastructure, provider, quota, or incomplete run) — exit `2`
- `configuration_failure` — exit `2`

Per-case failures remain separate as `semantic_failure`, `infrastructure_failure`, `provider_failure`, or `quota_failure`; rate limits and provider outages are never counted as semantic verdicts.

## Offline verification

```sh
npm run test:semantic-core-gate
node --check scripts/semantic-core-gate.mjs
node --check scripts/semantic-core-gate-lib.mjs
```

The offline suite covers URL authorization, request shape, release-pack composition, a deliberately red oracle, bounded rate-limit retry, artifact sanitization, and failure classification. It does not contact Capture or any model provider.
