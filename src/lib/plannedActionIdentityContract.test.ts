import { expect, it } from 'vitest';
import { actionIdentityPrompt, ActionIdentityAdjudicationSchema } from './plannedActionIdentity';

it('states the strict rationale length limit in the model contract', () => {
  const prompt = actionIdentityPrompt(
    [{ id: 'proposed', action: 'Compare steep times', source: 'Compare steep times.' }],
    [{ id: 'existing', text: 'Review the lesson outline' }],
  );
  expect(prompt).toContain('240 characters');
});

it('keeps the rationale boundary strict rather than truncating model output', () => {
  const decision = { proposedActionId: 'proposed', outcome: 'new', closestExistingActionId: 'existing', relation: 'distinct_outcome', rationale: 'x'.repeat(240) };
  expect(ActionIdentityAdjudicationSchema.safeParse({ decisions: [decision] }).success).toBe(true);
  expect(ActionIdentityAdjudicationSchema.safeParse({ decisions: [{ ...decision, rationale: 'x'.repeat(241) }] }).success).toBe(false);
});
