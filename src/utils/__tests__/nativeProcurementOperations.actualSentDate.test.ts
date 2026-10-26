import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  permissions: { send: true } as Record<string, unknown>,
  attempt: null as Record<string, unknown> | null,
}));

vi.mock('@/firebase', () => ({ functions: {}, auth: { currentUser: { uid: 'admin-1' } } }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (payload: Record<string, unknown>) => {
    mocks.calls.push(payload);
    const base = { ok: true, project_id: payload.project_id, po_id: payload.po_id };
    if (payload.operation === 'open') {
      return { data: { ...base, po_version: '1:1', material_version: '1:1', material_items: [], attempt: mocks.attempt,
        purchase_order: { id: payload.po_id, projectId: payload.project_id }, permissions: mocks.permissions } };
    }
    return { data: { ...base, attempt_id: payload.attempt_id ?? 'attempt-1', phase: 'complete', mode: payload.mode } };
  },
}));

import { createNativePOSendSession, type POSendIntent } from '../nativeProcurementOperations';

const sendCalls = () => mocks.calls.filter(call => call.operation === 'send');
// Callers outside the type system (stale state, scripts) can still reach send(); exercise that with untyped input.
const untyped = (session: Awaited<ReturnType<typeof open>>): ((intent: unknown) => Promise<unknown>) => session.send;
const open = async () => {
  const session = createNativePOSendSession('p1', 'po1', 'admin-1');
  await session.load();
  return session;
};
const mark = (actual_sent_date: string, recipient_email = 'vendor@acme.com'): POSendIntent =>
  ({ mode: 'mark', recipient_email, cc_emails: [], actual_sent_date });

describe('native PO send actual sent date', () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    mocks.permissions = { send: true };
    mocks.attempt = null;
  });

  it('freezes the actual sent day into the exact mark command', async () => {
    const session = await open();
    await session.send(mark('2026-10-18'));
    expect(sendCalls()).toHaveLength(1);
    expect(sendCalls()[0]).toMatchObject({ mode: 'mark', actual_sent_date: '2026-10-18', recipient_email: 'vendor@acme.com', cc_emails: [] });
  });

  it.each(['', '2026-02-30', '18/10/2026', '2026-10-18T00:00:00Z'])('refuses a mark with date %j before any send request', async (date) => {
    const session = await open();
    await expect(session.send(mark(date))).rejects.toThrow(/actual sent date/i);
    expect(sendCalls()).toHaveLength(0);
  });

  it('refuses a mark with no date at all', async () => {
    const session = await open();
    await expect(untyped(session)({ mode: 'mark', recipient_email: 'v@acme.com', cc_emails: [] })).rejects.toThrow(/actual sent date/i);
    expect(sendCalls()).toHaveLength(0);
  });

  it('forbids a date on an email send and never forwards it', async () => {
    const session = await open();
    await expect(untyped(session)({ mode: 'email', recipient_email: 'v@acme.com', cc_emails: [], actual_sent_date: '2026-10-18' })).rejects.toThrow();
    expect(sendCalls()).toHaveLength(0);
    await session.send({ mode: 'email', recipient_email: 'v@acme.com', cc_emails: [] });
    expect('actual_sent_date' in sendCalls()[0]).toBe(false);
  });

  it('replays the identical frozen command and rejects a different date or mode for the saved attempt', async () => {
    const session = await open();
    await session.send(mark('2026-10-18'));
    await session.send(mark('2026-10-18'));
    expect(sendCalls()[1]).toEqual(sendCalls()[0]);
    await expect(session.send(mark('2026-10-19'))).rejects.toMatchObject({ code: 'operation_conflict' });
    await expect(session.send({ mode: 'email', recipient_email: 'vendor@acme.com', cc_emails: [] })).rejects.toMatchObject({ code: 'operation_conflict' });
    expect(sendCalls()).toHaveLength(2);
  });

  it('accepts an optional legacy_send response flag but never infers send permission from it', async () => {
    mocks.permissions = { send: false, legacy_send: true };
    const session = await open();
    await expect(session.send(mark('2026-10-18'))).rejects.toMatchObject({ code: 'procurement_mutations_disabled' });
    expect(sendCalls()).toHaveLength(0);
  });

  it('rejects a snapshot whose send permission is not a boolean', async () => {
    mocks.permissions = { legacy_send: true };
    const session = createNativePOSendSession('p1', 'po1', 'admin-1');
    await expect(session.load()).rejects.toThrow();
  });
});
