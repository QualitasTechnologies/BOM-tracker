import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ server: null as null | { call: (payload: Record<string, unknown>) => Promise<unknown> } }));
vi.mock('@/firebase', () => ({ functions: {}, auth: { currentUser: { uid: 'admin' } } }));
// The callable transport is the only seam replaced: payloads go to the real backend engine and fixture database.
vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (payload: Record<string, unknown>) => ({ data: await bridge.server!.call(payload) }),
}));

import { createNativePOSendSession } from '../nativeProcurementOperations';

const require = createRequire(import.meta.url);
const { fixture } = require('../../../functions/nativeProcurementFixture.cjs');
type Server = ReturnType<typeof fixture>;
const mark = (actual_sent_date: unknown) => ({ mode: 'mark', recipient_email: 'vendor@example.com', cc_emails: [], actual_sent_date }) as never;
const open = async (server: Server) => {
  bridge.server = server;
  const session = createNativePOSendSession('P', 'PO', 'admin');
  await session.load();
  return session;
};
// A brand-new session models a reload: it knows nothing except what the real engine reports.
const freshSession = async (server: Server) => { bridge.server = server; return createNativePOSendSession('P', 'PO', 'admin'); };
const attempts = (server: Server) => [...server.docs.keys()].filter(path => path.startsWith('pulseProcurementOperations/P/attempts/'));
const item = (server: Server) => server.docs.get('projects/P/bom/data').categories[0].items[0];

describe('real client to real procurement engine: manual actual_sent_date', () => {
  it('stores the exact entered day on the PO and unentered material through the real engine', async () => {
    const server = fixture();
    server.docs.get('projects/P/purchaseOrders/PO').items[0].dueDate = '2026-11-20';
    const sent = await (await open(server)).send(mark('2028-02-29'));
    expect(sent.phase).toBe('complete');
    const reopened = await (await freshSession(server)).load();
    expect((reopened.attempt as { actual_sent_date?: string } | null)?.actual_sent_date).toBe('2028-02-29');
    expect(server.docs.get('projects/P/purchaseOrders/PO').actualSentDate).toBe('2028-02-29');
    expect(item(server).orderDate).toBe('2028-02-29');
    expect(item(server).expectedArrival).toBe('2026-11-20');
    expect(server.calls).toHaveLength(0);
  });

  it('missing or invalid dates never reach a write, and the engine itself also refuses them', async () => {
    const server = fixture();
    const session = await open(server);
    for (const bad of [undefined, '', '2026-02-30', '2027-02-29', '2026-10-17T00:00:00Z']) {
      await expect(session.send(mark(bad))).rejects.toThrow();
    }
    expect(attempts(server)).toEqual([]);
    const opening = await server.call({ operation: 'open' }) as { po_version: string; material_version: string };
    const direct = await server.call({ operation: 'send', attempt_id: 'direct-1', expected_po_version: opening.po_version, expected_material_version: opening.material_version,
      mode: 'mark', recipient_email: 'vendor@example.com', cc_emails: [], actual_sent_date: '2026-02-30' });
    expect(direct).toEqual({ ok: false, error: 'invalid_procurement_request' });
    expect(attempts(server)).toEqual([]);
    expect(server.docs.get('projects/P/purchaseOrders/PO').status).toBe('pending-approval');
  });

  it('a retried request keeps the original day; a different day cannot replace the frozen request', async () => {
    let failed = false;
    const server = fixture({ failWrite: (writes: Array<[string]>) => {
      if (!failed && writes.some(([path]) => path.endsWith('-finalized'))) { failed = true; return true; }
      return false;
    } });
    const session = await open(server);
    expect((await session.send(mark('2026-10-17'))).phase).toBe('metadata_pending');
    const pending = await (await freshSession(server)).load();
    expect((pending.attempt as { actual_sent_date?: string } | null)?.actual_sent_date).toBe('2026-10-17');
    await expect(session.send(mark('2026-10-18'))).rejects.toThrow();
    server.advance(60 * 60 * 1000);
    expect((await session.recover()).phase).toBe('complete');
    const [attemptPath] = attempts(server);
    expect(server.docs.get(attemptPath).actual_sent_date).toBe('2026-10-17');
    expect(server.docs.get('projects/P/purchaseOrders/PO').actualSentDate).toBe('2026-10-17');
    expect(item(server).orderDate).toBe('2026-10-17');
  });
});
