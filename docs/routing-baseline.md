# R1 sequential routing baseline

`npm run baseline:routing` measures the recovery build through `/api/sort`. It uses the 11 fixed cases and a 31-Thread, clearly synthetic accumulated board in `scripts/routing-baseline-cases.json`. Every response is applied only to that in-memory board before the next request. The harness imports the production `threadBriefs()` implementation, including its shared total budget and per-Thread bounds, instead of maintaining a second request-context algorithm. The harness never reads `.env*`, cookies, credentials, IndexedDB, or `/api/cloud/board`, and it never writes Capture data.

## Run later against localhost

Start the intended recovery build separately, then run:

```sh
npm run baseline:routing -- --out outputs/routing-baseline/recovery-local.json
```

The default target is `http://localhost:3000`. An alternate loopback origin must be explicit:

```sh
npm run baseline:routing -- --local http://127.0.0.1:4998 --out outputs/routing-baseline/recovery-local.json
```

This spends live provider quota. It was not run while implementing R1.

## Run later against an isolated Preview

Remote use is opt-in and accepts only an HTTPS immutable Vercel Preview deployment URL (not a custom domain or ordinary production alias):

```sh
npm run baseline:routing -- --remote https://capture-cfrm3i0d9-glebbogachev00s-projects.vercel.app --out outputs/routing-baseline/recovery-preview-r1-integrity.json
```

The Preview must already expose `/api/sort` without credentials and must be configured as an isolated local-mode/dead-hub deployment. The harness does not authenticate, read secrets, or access a Cloud board.

## Artifact and regression check

The JSON artifact contains only fixed synthetic material: raw case inputs, each observed destination share, and categorical measurements (exact destination sets, kind, action count, latency, provider `via`, HTTP status, pass/fail, and reason codes). Every existing or new destination share must satisfy its fixed per-case subject expectation; negated subjects and named unrelated subjects do not count. New Threads must also satisfy the fixed name expectation. Extra, missing, duplicate, unknown, swapped, or semantically wrong destinations fail. Unbounded provider prose and error bodies are excluded. Output files are created with owner-only permissions under the ignored `outputs/` directory by default.

After an owner accepts an artifact, compare a later run with it:

```sh
npm run baseline:routing -- --compare outputs/routing-baseline/recovery-local.json --out outputs/routing-baseline/candidate-local.json
```

A failed oracle case or a changed result for a previously passing case exits nonzero. Transport/setup aborts exit with status 2.

Offline safety tests:

```sh
npm run test:routing-baseline
```
