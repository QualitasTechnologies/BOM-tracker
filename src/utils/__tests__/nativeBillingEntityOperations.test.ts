import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeBillingEntitySession } from '../nativeBillingEntityOperations';

describe('original Billing Settings native session', () => {
  beforeEach(() => sessionStorage.clear());
  const setup = () => {
    let uid = 'admin', fail = false, after: (() => void) | undefined;
    const calls: Record<string, any>[] = [];
    const callable = vi.fn(async (body: Record<string, any>) => {
      calls.push(structuredClone(body)); after?.();
      if (fail) throw Error('network');
      if (body.operation === 'catalog') return { data: { ok: true, entities: [], catalog_version: 'a'.repeat(64), permissions: { create: true, set_default: true } } };
      if (body.operation === 'get') return { data: { ok: true, entity: { id: body.entity_id, legalName: 'Original' }, entity_version: '10:1', permissions: { edit: true, delete: true } } };
      return { data: body.resolve_only ? { ok: true, resolution: 'cancelled' } : { ok: true, entity_id: body.entity_id, operation_id: body.operation_id, kind: body.operation } };
    });
    const deps = { currentUid: async () => uid, nonce: () => 'nonce-1', callable };
    const make = () => createNativeBillingEntitySession('admin', () => true, deps);
    return { deps, calls, make, setUid: (value: string) => { uid = value; }, setFail: (value: boolean) => { fail = value; }, setAfter: (value: () => void) => { after = value; } };
  };
  const request = () => ({ operation: 'update' as const, entity_id: 'B', expected_version: '10:1', patch: { phone: '123', logo: 'confirmed-upload', logoPath: 'company-logos/logo.png' } });

  it('reads the authoritative entity opening and never substitutes another identity', async () => {
    const f = setup(), s = f.make(); expect((await s.open('B')).entity_version).toBe('10:1');
    f.setUid('other'); await expect(s.open('B')).rejects.toThrow(/account/i); expect(f.calls).toHaveLength(1);
  });
  it('persists exact version, nonce and uploaded logo before sending; an uncertain retry uses identical input', async () => {
    const f = setup(), s = f.make(), input = request(); f.setFail(true);
    await expect(s.mutate(input)).rejects.toThrow(); input.patch.phone = 'later edit';
    expect(s.pending()).toBe(true); f.setFail(false); await s.retry();
    expect(f.calls[1]).toEqual(f.calls[0]); expect(f.calls[1].patch.phone).toBe('123');
    expect(f.calls[1].patch.logo).toBe('confirmed-upload');
  });
  it('blocks another action while an uncertain save is retained, including after remount', async () => {
    const f = setup(), s = f.make(); f.setFail(true); await expect(s.mutate(request())).rejects.toThrow();
    await expect(f.make().mutate({ operation: 'delete', entity_id: 'B', expected_version: '10:1' })).rejects.toThrow(/saved/i);
    expect(f.calls).toHaveLength(1);
  });
  it('resolves an absent commit to cancellation and reads authoritative state before clearing recovery', async () => {
    const f = setup(), s = f.make(); f.setFail(true); await expect(s.mutate(request())).rejects.toThrow();
    f.setFail(false); expect(await s.resolve()).toBe('cancelled'); expect(s.pending()).toBe(true);
    await s.acknowledge(); expect(s.pending()).toBe(false); expect(f.calls.at(-1)?.operation).toBe('catalog');
    await expect(s.retry()).rejects.toThrow();
  });
  it('keeps a committed request when the account changes during the reply', async () => {
    const f = setup(), s = f.make(); f.setAfter(() => f.setUid('other'));
    await expect(s.mutate(request())).rejects.toThrow(/account/i); expect(s.pending()).toBe(true);
  });
  it('storage replacement by another mounted session cannot be overwritten or cleared', async () => {
    const f = setup(), s = f.make(); f.setFail(true); await expect(s.mutate(request())).rejects.toThrow();
    sessionStorage.setItem(sessionStorage.key(0)!, '{}'); f.setFail(false);
    await expect(s.retry()).rejects.toThrow(/saved|recovery/i); expect(f.calls).toHaveLength(1);
  });
  it('does not release a saved request when authoritative refresh fails', async () => {
    const f = setup(), s = f.make(); await s.mutate(request()); f.setFail(true);
    await expect(s.acknowledge()).rejects.toThrow(); expect(s.pending()).toBe(true);
  });
  it('rejects malformed or mismatched mutation replies without losing the saved request', async () => {
    const f = setup(); f.deps.callable = vi.fn(async () => ({ data: { ok: true, entity_id: 'different', operation_id: 'nonce-1', kind: 'update' } }));
    const s = f.make(); await expect(s.mutate(request())).rejects.toThrow(); expect(s.pending()).toBe(true);
  });
  it('never sends when persisting the request failed, even on a later retry', async () => {
    const f = setup(), s = f.make();
    const broken = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw Error('quota'); });
    await expect(s.mutate(request())).rejects.toThrow();
    await expect(s.retry()).rejects.toThrow(); expect(f.calls).toHaveLength(0); broken.mockRestore();
  });
});
