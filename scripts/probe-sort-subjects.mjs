#!/usr/bin/env node
// Live /api/sort only: spends provider quota, never reads credentials or writes boards.
// node scripts/probe-sort-subjects.mjs [http://localhost:4998] [--repeat 1] [--out /tmp/sort-subjects.json]
import { readFile, writeFile } from 'node:fs/promises';

function options(args) {
  let base = 'http://localhost:4998', repeat = 1, out;
  let positional = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--repeat') {
      const value = args[++i];
      if (!/^[1-9]\d*$/.test(value ?? '') || !Number.isSafeInteger(Number(value))) throw Error('--repeat must be a positive integer');
      repeat = Number(value);
    } else if (arg === '--out') {
      out = args[++i];
      if (!out || out.startsWith('--')) throw Error('--out requires a JSON path');
    } else if (!arg.startsWith('-') && !positional) {
      base = arg;
      positional = true;
    } else throw Error(`Unknown argument: ${arg}`);
  }
  const url = new URL('/api/sort', base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Use an HTTP(S) base URL without credentials');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('This probe is local-only; start the candidate on localhost');
  return { url: url.href, repeat, out };
}

// Content-based checks deliberately do not assume which subject is primary.
const ui = /\b(?:navbar|nav\s*bar|navigation|pricing|trycapture\.app|capture\s+ui)\b/i;
const askde = /\baskde\b/i;
const posting = /\b(?:posts?|posting|robotic|human|tone)\b/i;
const price = /\$50\b/;
const screenshot = /\b(?:pricing|screenshot|self-hosted|supporter|cloud|yearly|monthly)\b|\$\d/i;
const nonempty = (v) => typeof v === 'string' && v.trim().length > 0;

function judge(test, result) {
  const failures = [];
  const check = (ok, message) => { if (!ok) failures.push(message); };
  if (!result || typeof result !== 'object' || Array.isArray(result)) return ['Response is not an object'];
  check(nonempty(result.clean), 'clean is missing');
  check(Array.isArray(result.actions), 'actions is not an array');
  check(result.also == null || Array.isArray(result.also), 'also is not an array/null');
  const also = Array.isArray(result.also) ? result.also : [];
  const actions = Array.isArray(result.actions) ? result.actions : [];
  const actionMeta = Array.isArray(result.actionMeta) ? result.actionMeta : [];
  check(actionMeta.length === actions.length, `actionMeta has ${actionMeta.length} rows for ${actions.length} actions`);
  for (const row of actionMeta) {
    check(nonempty(row?.source), 'Action source ownership is missing');
    check(['hours', 'days', 'weeks', 'keep'].includes(row?.shelfLife), 'Action shelf ownership is invalid');
  }
  const destinations = [
    { threadId: result.threadId, threadName: result.threadName, text: also.length ? result.primaryText : result.clean },
    ...also,
  ].filter((d) => d && (nonempty(d.threadId) || nonempty(d.threadName)));
  const keys = destinations.map((d) => d.threadId || d.threadName.trim().toLowerCase());
  check(new Set(keys).size === keys.length, 'Duplicate destination IDs/names');
  if (test.expect === 'actions') {
    check(result.kind === 'action', `Expected action, got ${result.kind}`);
    check(destinations.length === 0 && also.length === 0, 'Errands must not create threads');
    check(actions.length === 2, `Expected two errands, got ${actions.length}`);
    check(actions.some((a) => /\bcall\b.*\bdentist\b/i.test(a)), 'Missing call dentist action');
    check(actions.some((a) => /\bbuy\b.*\bmilk\b/i.test(a)), 'Missing buy milk action');
    check(/dentist/i.test(result.clean) && /milk/i.test(result.clean), 'clean lost an errand');
    return failures;
  }
  check(test.request.force ? result.kind === 'thread' : ['thread', 'both'].includes(result.kind), `Expected ${test.request.force ? 'thread' : 'thread/both'}, got ${result.kind}`);
  check(actions.length === 0, `Invented/unwanted tasks: ${JSON.stringify(actions)}`);
  if (test.expect === 'single') {
    check(destinations.length === 1 && also.length === 0, `Same goal needs one thread, got ${destinations.length} destinations and ${also.length} also shares`);
    check(/navbar/i.test(result.clean) && /mobile/i.test(result.clean) && /spacing/i.test(result.clean), 'clean lost navigation details');
    return failures;
  }
  check(destinations.length === 2 && also.length === 1, `Expected two destinations, got ${destinations.length} destinations and ${also.length} also shares`);
  check(nonempty(result.primaryText), 'Split requires explicit primaryText');
  check(ui.test(result.clean) && askde.test(result.clean) && posting.test(result.clean) && price.test(result.clean), 'clean lost UI, Askde, posting, or $50 context');
  const uiShares = destinations.filter((d) => ui.test(d.text));
  const askdeShares = destinations.filter((d) => askde.test(d.text));
  check(uiShares.length === 1, `UI subject appears in ${uiShares.length} shares (must be exactly one)`);
  check(askdeShares.length === 1, `Askde subject appears in ${askdeShares.length} shares (must be exactly one)`);
  const uiShare = uiShares[0], askdeShare = askdeShares[0];
  check(Boolean(uiShare && askdeShare && uiShare !== askdeShare), 'UI and Askde are not separated');
  if (uiShare) {
    check(price.test(uiShare.text), 'UI share lost screenshot pricing $50');
    if (/Attached photo:/i.test(test.request.raw)) {
      check(uiShare === destinations[0] && ui.test(result.primaryText) && price.test(result.primaryText), 'Attached-photo context must stay with the primary UI share');
    }
    check(!askde.test(uiShare.text) && !posting.test(uiShare.text), 'UI share contains Askde/posting content');
  }
  if (askdeShare) {
    check(posting.test(askdeShare.text), 'Askde share lost posting/tone content');
    check(!ui.test(askdeShare.text) && !screenshot.test(askdeShare.text), 'Askde share contains UI/screenshot pricing content');
  }
  for (const d of destinations) {
    check(nonempty(d.text), 'Destination has no subject text');
    const name = d.threadName || test.request.threads.find((t) => t.id === d.threadId)?.name || '';
    check(nonempty(name), 'Destination has no resolvable name');
    check(!(ui.test(name) && (askde.test(name) || posting.test(name))), `Combined subject name: ${name}`);
    if (d === uiShare) check(!askde.test(name) && !posting.test(name), `UI destination wrongly named: ${name}`);
    if (d === askdeShare) check(!ui.test(name), `Askde destination wrongly named: ${name}`);
  }
  if (test.expect === 'split-reuse') {
    check(uiShare?.threadId === 'capture-ui', `UI must reuse capture-ui, got ${uiShare?.threadId}`);
    check(askdeShare?.threadId === 'askde-posts', `Askde must reuse askde-posts, got ${askdeShare?.threadId}`);
    check(destinations.every((d) => !d.threadName), 'Reused destinations should not propose new names');
  }
  return failures;
}

async function main() {
  const { url, repeat, out } = options(process.argv.slice(2));
  const cases = JSON.parse(await readFile(new URL('../src/lib/sortSubjectCases.json', import.meta.url), 'utf8'));
  const evidence = { startedAt: new Date().toISOString(), endpoint: url, repeat, timeoutMs: 60000, runs: [] };
  for (let iteration = 1; iteration <= repeat; iteration++) {
    for (const test of cases) {
      const started = Date.now();
      const run = { id: test.id, iteration, request: test.request, expect: test.expect };
      try {
        const response = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...test.request,
            localDate: new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          }), signal: AbortSignal.timeout(60000), redirect: 'error',
        });
        run.status = response.status;
        run.responseText = await response.text();
        try { run.result = JSON.parse(run.responseText); } catch { /* Keep raw evidence. */ }
        run.failures = response.ok ? judge(test, run.result) : [`HTTP ${response.status}: ${run.responseText}`];
      } catch (error) {
        run.error = { name: error.name, message: error.message, cause: error.cause?.message };
        run.failures = [`${error.name}: ${error.message}`];
      }
      run.durationMs = Date.now() - started;
      run.pass = run.failures.length === 0;
      evidence.runs.push(run);
      console.log(`${run.pass ? 'PASS' : 'FAIL'} ${test.id} #${iteration} (${run.durationMs}ms)${run.result ? ` kind=${run.result.kind} via=${run.result.via}` : ''}`);
      for (const failure of run.failures) console.log(`  - ${failure}`);
    }
  }
  evidence.finishedAt = new Date().toISOString();
  evidence.passed = evidence.runs.filter((r) => r.pass).length;
  evidence.failed = evidence.runs.length - evidence.passed;
  if (out) await writeFile(out, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`${evidence.passed}/${evidence.runs.length} passed; ${evidence.failed} failed${out ? `; evidence: ${out}` : ''}`);
  process.exitCode = evidence.failed ? 1 : 0;
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
