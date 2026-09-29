import assert from 'node:assert/strict';
import test from 'node:test';
import { runSequentialBaseline, parseTarget } from './routing-baseline-lib.mjs';

const raw = 'The final passage needs a clearer owner.';
const pack = {
  revision: 'pending-contract',
  initialBoard: { threads: [], actions: [], intentions: [], ledger: [] },
  cases: [{ id: 'ambiguous', raw, covers: ['ambiguity'], expected: { destinations: [], kinds: ['pending'], actions: { min: 0, max: 0 }, fallback: 'pending' }, destinationExpectations: {} }],
};
const candidate = {
  planned: true, kind: 'action', actions: [], threadId: null, threadName: null, also: [],
  unresolved: [raw],
  routingPlan: { items: [{ id: 'one', source: raw, unresolved: true, destinations: [], kind: 'developing_thought', action: null }], newThreads: [] },
};
const run = async (value) => (await runSequentialBaseline({
  target: parseTarget(['--local', 'http://localhost:3198']), casePack: pack,
  fetchImpl: async () => new Response(JSON.stringify(value), { status: 200 }),
})).runs[0];

test('pending qualification requires exact preserved source and no settled items', async () => {
  assert.equal((await run(candidate)).pass, true);
  for (const changed of [
    { ...candidate, unresolved: ['shortened'] },
    { ...candidate, routingPlan: undefined },
    { ...candidate, routingPlan: { ...candidate.routingPlan, items: [{ ...candidate.routingPlan.items[0], unresolved: false }] } },
    { ...candidate, actions: ['Invented work'] },
  ]) assert.equal((await run(changed)).pass, false);
});
