import { describe, expect, it } from 'vitest';
import { compileRoutingPlan, type PlannedRoutingPlan, type RoutingPlanContext } from './plannedRouting';
const base = { due: null, ownerId: null, action: null, destinations: [], duplicateActionId: null, unresolved: false, ambiguity: null };
const context = (raw: string): RoutingPlanContext => ({ captureId:'mixed', raw, threads:[{id:'health',name:'Health',about:'Health and work balance'}], actions:[], now:1, recovery:{ clean:raw, kind:'intention', title:'Mixed capture', actions:[], threadId:null, threadName:null } });
describe('mixed plan compatibility output', () => {
  it('does not suppress explicit Actions when the same plan includes an Intention', () => {
    const plan: PlannedRoutingPlan = { items:[
      {...base,id:'task',source:'Send the note. ',kind:'action',action:'Send the note'},
      {...base,id:'stance',source:'I protect my evenings.',kind:'intention'},
    ],newThreads:[] };
    const result=compileRoutingPlan(plan,context(plan.items.map(i=>i.source).join('')));
    expect(result.kind).toBe('action');
    expect(result.actions).toEqual(['Send the note']);
    expect(result.actionDetails).toHaveLength(1);
  });
  it('keeps the thought destination visible when an Intention is also present', () => {
    const plan: PlannedRoutingPlan = { items:[
      {...base,id:'thought',source:'Training intensity affects concentration. ',kind:'developing_thought',destinations:[{type:'existing',threadId:'health'}]},
      {...base,id:'stance',source:'I protect my evenings.',kind:'intention'},
    ],newThreads:[] };
    const result=compileRoutingPlan(plan,context(plan.items.map(i=>i.source).join('')));
    expect(result.kind).toBe('thread');
    expect(result.threadId).toBe('health');
    expect(result.primaryText).toBe('Training intensity affects concentration.');
    expect(plan.items[1].kind).toBe('intention');
  });
});
