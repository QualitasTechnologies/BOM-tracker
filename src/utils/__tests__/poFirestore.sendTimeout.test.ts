import { beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; options: unknown; payload: unknown }>,
}));

vi.mock('@/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string, options?: unknown) => async (payload: unknown) => {
    mocks.calls.push({ name, options, payload });
    return { data: { success: true, ok: true, phase: 'complete', released: true, message: 'sent', pdfUrl: '' } };
  },
}));

import {
  recoverAcceptedLegacyPOSend,
  recoverStaleLegacyPOSend,
  retryUncertainLegacyPOSend,
  sendPOEmail,
  sendPurchaseOrder,
} from '../poFirestore';

// @firebase/functions defaults to a 70s client timeout. Server callables that may run longer (timeoutSeconds: 540 in
// functions/index.js) must pass the same limit or the user sees deadline-exceeded while the server is still finishing.
const SERVER_540S = 540_000;

describe('PO callable client timeouts', () => {
  beforeEach(() => { mocks.calls.length = 0; });

  it('sendPOEmail waits as long as the sendPurchaseOrder server limit', async () => {
    const input = { projectId: 'p1', poId: 'po1' } as Parameters<typeof sendPOEmail>[0];
    await sendPOEmail(input);
    expect(mocks.calls).toEqual([{ name: 'sendPurchaseOrder', options: { timeout: SERVER_540S }, payload: input }]);
  });

  it('retryUncertainLegacyPOSend waits as long as the retryUncertainLegacyPOSend server limit', async () => {
    await retryUncertainLegacyPOSend('p1', 'po1', 'attempt-1');
    expect(mocks.calls).toEqual([{
      name: 'retryUncertainLegacyPOSend', options: { timeout: SERVER_540S },
      payload: { project_id: 'p1', po_id: 'po1', attempt_id: 'attempt-1' },
    }]);
  });

  it('keeps the SDK default for callables whose server limit is under 70s', async () => {
    await sendPurchaseOrder('p1', 'po1', { sentBy: 'a', sentToEmail: 'v@acme.com', actualSentDate: '2026-10-18' }, 'op_1');
    await recoverStaleLegacyPOSend('p1', 'po1', 'attempt-1');
    await recoverAcceptedLegacyPOSend('p1', 'po1', 'attempt-1');
    expect(mocks.calls.map(c => [c.name, c.options])).toEqual([
      ['legacyMarkPurchaseOrderSent', undefined],
      ['recoverStaleLegacyPOSend', undefined],
      ['recoverAcceptedLegacyPOSend', undefined],
    ]);
  });
});
