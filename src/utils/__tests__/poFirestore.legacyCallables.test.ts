import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; payload: unknown }>,
  result: { data: { ok: true } } as { data: Record<string, unknown> },
  updateDoc: vi.fn(),
  getDoc: vi.fn(),
}));

vi.mock('@/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => async (payload: unknown) => {
    mocks.calls.push({ name, payload });
    return mocks.result;
  },
}));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  doc: vi.fn(() => ({})),
  collection: vi.fn(() => ({})),
  updateDoc: (...args: unknown[]) => mocks.updateDoc(...args),
  getDoc: (...args: unknown[]) => mocks.getDoc(...args),
}));

import {
  acceptedAtToBusinessDate,
  getPOPromisedDates,
  recoverAcceptedLegacyPOSend,
  recoverStaleLegacyPOSend,
  retryUncertainLegacyPOSend,
  sendPurchaseOrder,
} from '../poFirestore';

describe('legacy PO callables', () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    mocks.updateDoc.mockReset();
    mocks.getDoc.mockReset();
    mocks.result = { data: { ok: true } };
  });

  it('marks sent through the authorized server callable with the actual calendar day and never writes Firestore directly', async () => {
    await sendPurchaseOrder('p1', 'po1', { sentBy: 'admin-1', sentToEmail: 'vendor@acme.com', actualSentDate: '2026-10-18' }, 'op_1');
    expect(mocks.calls).toEqual([{ name: 'legacyMarkPurchaseOrderSent', payload: {
      project_id: 'p1', po_id: 'po1', operation_id: 'op_1', expected_actor_uid: 'admin-1',
      actual_sent_date: '2026-10-18', sent_to_email: 'vendor@acme.com',
    } }]);
    expect(mocks.updateDoc).not.toHaveBeenCalled();
    expect(mocks.getDoc).not.toHaveBeenCalled();
  });

  it.each(['', '2026-02-30', '18/10/2026', '2026-10-18T00:00:00Z'])('rejects invalid actual sent date %j before calling the server', async (actualSentDate) => {
    await expect(sendPurchaseOrder('p1', 'po1', { sentBy: 'a', sentToEmail: 'v@acme.com', actualSentDate }, 'op_1')).rejects.toThrow('actual sent date');
    expect(mocks.calls).toEqual([]);
  });

  it('rejects an unsafe operation id and surfaces a denied server response without a raw fallback', async () => {
    await expect(sendPurchaseOrder('p1', 'po1', { sentBy: 'a', sentToEmail: 'v@acme.com', actualSentDate: '2026-10-18' }, 'bad/id')).rejects.toThrow('operation');
    mocks.result = { data: { ok: false, error: 'procurement_forbidden' } };
    await expect(sendPurchaseOrder('p1', 'po1', { sentBy: 'a', sentToEmail: 'v@acme.com', actualSentDate: '2026-10-18' }, 'op_2')).rejects.toThrow('procurement_forbidden');
    expect(mocks.updateDoc).not.toHaveBeenCalled();
  });

  it('releases only a named stale reservation and requires the server to confirm the release', async () => {
    mocks.result = { data: { ok: true, released: true } };
    await recoverStaleLegacyPOSend('p1', 'po1', 'attempt-1');
    expect(mocks.calls).toEqual([{ name: 'recoverStaleLegacyPOSend', payload: { operation: 'release_stale_preparing', project_id: 'p1', po_id: 'po1', attempt_id: 'attempt-1' } }]);
    mocks.result = { data: { ok: true, released: false } };
    await expect(recoverStaleLegacyPOSend('p1', 'po1', 'attempt-1')).rejects.toThrow('recover');
  });

  it('finalizes an accepted send only when the server reports the complete phase', async () => {
    mocks.result = { data: { ok: true, phase: 'complete' } };
    await recoverAcceptedLegacyPOSend('p1', 'po1', 'attempt-1');
    expect(mocks.calls).toEqual([{ name: 'recoverAcceptedLegacyPOSend', payload: { project_id: 'p1', po_id: 'po1', attempt_id: 'attempt-1' } }]);
    mocks.result = { data: { ok: true, phase: 'needs_reconciliation' } };
    await expect(recoverAcceptedLegacyPOSend('p1', 'po1', 'attempt-1')).rejects.toThrow();
  });

  it('retries an uncertain send with the saved immutable attempt id only', async () => {
    mocks.result = { data: { ok: true, phase: 'complete' } };
    await retryUncertainLegacyPOSend('p1', 'po1', 'attempt-1');
    expect(mocks.calls).toEqual([{ name: 'retryUncertainLegacyPOSend', payload: { project_id: 'p1', po_id: 'po1', attempt_id: 'attempt-1' } }]);
    mocks.result = { data: { ok: false, error: 'retry_window_expired' } };
    await expect(retryUncertainLegacyPOSend('p1', 'po1', 'attempt-1')).rejects.toThrow('retry_window_expired');
  });

  it('exposes the date helpers: promised dates preserved, absent stays unset', () => {
    expect(getPOPromisedDates({ items: [{ bomItemId: 'a' }] } as never)).toEqual({});
    expect(acceptedAtToBusinessDate()).toBeUndefined();
  });
});
