/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Capture } from '@/app/Capture';
import { EMPTY, KEY } from '@/lib/model';
import * as storage from '@/lib/storage';
import { TOMBSTONE_KEY } from '@/lib/sync';
import { PENDING_RECOVERY_KEY } from '@/lib/pendingRecovery';
import { MANUAL_ROUTING_UNDO_KEY } from '@/lib/manualRoutingUndo';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
beforeEach(async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.scrollIntoView = vi.fn();
  await storage.del(PENDING_RECOVERY_KEY);
  await storage.del(MANUAL_ROUTING_UNDO_KEY);
  await storage.set(TOMBSTONE_KEY, '[]');
  await storage.set(KEY, JSON.stringify({ ...EMPTY, principles: [] }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('keeps durable in-flight captures out of Unsorted and shows manual recovery only after sorting fails', async () => {
  let release!: (response: Response) => void;
  const deferred = new Promise<Response>(resolve => { release = resolve; });
  let sortCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/sort') { sortCalls++; return (await deferred).clone(); }
    return new Response(null, { status: 503 });
  }));
  render(<Capture />);
  await screen.findByText('No open loops.', { exact: true });
  fireEvent.change(screen.getByPlaceholderText('Say it however it comes out.'), { target: { value: 'hello' } });
  fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
  await waitFor(() => expect(sortCalls).toBe(1));
  expect(JSON.parse((await storage.get(KEY))!).actions.some((a: { unsorted?: boolean; src?: string }) => a.unsorted && a.src === 'hello')).toBe(true);
  expect(screen.queryByRole('button', { name: /^Unsorted/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Choose a place' })).toBeNull();
  expect(screen.getByText('Saved. Sorting…')).toBeTruthy();
  await act(async () => release(new Response(JSON.stringify({ error: 'synthetic provider failure' }), { status: 502 })));
  await screen.findByRole('button', { name: /^Unsorted 1/ });
  expect(sortCalls).toBeLessThanOrEqual(2);
  expect(JSON.parse((await storage.get(KEY))!).actions.some((a: { unsorted?: boolean; src?: string }) => a.unsorted && a.src === 'hello')).toBe(true);
});
