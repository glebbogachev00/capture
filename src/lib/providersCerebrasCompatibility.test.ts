import { afterEach, expect, it, vi } from 'vitest';
import { chain } from './providers';
afterEach(() => vi.unstubAllEnvs());
it('does not send the unsupported hidden reasoning format to the configured Qwen model', () => {
  vi.stubEnv('CEREBRAS_API_KEY','synthetic-provider-key');
  vi.stubEnv('CEREBRAS_MODEL','qwen-3.8-27b');
  const tier=chain().find(item=>item.name==='cerebras');
  expect(tier).toBeDefined();
  expect(tier?.providerOptions?.cerebras?.reasoningFormat).toBeUndefined();
});
