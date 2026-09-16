// Local-only, quota-consuming regression probe. Run before/after the fix:
// node scripts/probe-summary-grounding.mjs [--case=short] [--repeat=3]
import assert from 'node:assert/strict';
const base = 'http://localhost:4998';
const at = Date.UTC(2026, 8, 10);
const fragment = 'Also find a way to refine my Askde posting strategy so that the posts that are made actually sound human.';
const fixtures = [
  { id: 'short', body: { name: 'Askde', frags: [{ at, text: fragment }] }, required: [/human/i, /post/i] },
  { id: 'neighbors', body: { name: 'Askde', frags: [{ at, text: fragment }], open: ['Send the lunar telescope invoice'], siblings: ['Capture billing', 'Lunar telescope'] }, required: [/human/i], forbidden: /lunar|telescope|invoice|billing/i },
  { id: 'long', body: { name: 'Askde', frags: [
    { at, text: 'Askde posts currently sound too polished and generic. I want to write from actual work rather than generic advice. Keep the rough phrasing where it sounds like me.' },
    { at: at + 1000, text: 'The audience is independent builders. I have not chosen a posting schedule. No autopublishing: I must approve every draft.' },
    { at: at + 2000, text: fragment },
  ] }, required: [/human|rough|generic/i, /approv/i], forbidden: /(?:schedule is|post daily|daily posting)/i },
  { id: 'correction', body: { name: 'Askde', frags: [
    { at, text: 'Plan: post three times daily and autopublish Askde drafts.' },
    { at: at + 1000, text: 'Correction: cancel that plan. No autopublishing and no daily schedule. I will manually approve one weekly Askde post. The posts need to sound human.' },
  ], open: ['Manually approve one weekly Askde post'] }, required: [/week/i, /manual|approv/i, /human/i], nextNull: true },
];
const selected = process.argv.find(x => x.startsWith('--case='))?.split('=')[1];
const repeat = Number(process.argv.find(x => x.startsWith('--repeat='))?.split('=')[1] ?? 1);
assert(Number.isInteger(repeat) && repeat > 0 && repeat <= 10);
assert(!selected || fixtures.some(x => x.id === selected), 'unknown fixture');
let failures = 0;
for (let run = 1; run <= repeat; run++) for (const fixture of fixtures.filter(x => !selected || x.id === selected)) {
  let response;
  for (let attempt = 0; attempt < 4; attempt++) {
    response = await fetch(`${base}/api/summarize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fixture.body), signal: AbortSignal.timeout(90000) });
    if (response.status !== 429 || attempt === 3) break;
    const header = response.headers.get('retry-after');
    const seconds = header && /^\d+$/.test(header) ? Number(header) : 60;
    console.log(JSON.stringify({ fixture: fixture.id, retryAfterSec: seconds }));
    await new Promise(resolve => setTimeout(resolve, (seconds + 1) * 1000));
  }
  const output = await response.json();
  try {
    assert.equal(response.status, 200, JSON.stringify(output));
    assert.equal(typeof output.summary, 'string');
    assert(output.summary.trim());
    assert(!/where this stands|2[-–]5 sentences|NEXT\s*:|BELONGS\s*:|sorting engine|summari[sz](?:e|ing) the summary|explicitly requested.*(?:prose|sentences|block)/i.test(output.summary), 'instructions leaked into summary');
    for (const pattern of fixture.required) assert(pattern.test(output.summary), `missing ${pattern}`);
    if (fixture.forbidden) assert(!fixture.forbidden.test(output.summary), 'invented or neighboring fact');
    if (fixture.nextNull) assert.equal(output.next, null, 'already-open step repeated');
    if (fixture.body.siblings) assert.equal(typeof output.belongs, 'string');
    else assert.equal(output.belongs, null);
    console.log(JSON.stringify({ run, fixture: fixture.id, pass: true, output }));
  } catch (error) {
    failures++;
    console.log(JSON.stringify({ run, fixture: fixture.id, pass: false, error: error.message, output }));
  }
}
process.exitCode = failures ? 1 : 0;
