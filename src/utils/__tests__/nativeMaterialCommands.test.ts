import { describe, expect, it, vi } from 'vitest';
import { createNativeMaterialCommandClient } from '../nativeMaterialCommands';

describe('native BOM material command client', () => {
  it('reads the current version, sends one bounded command, and reuses the server receipt', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true, project_id: 'P', version: '42:7', categories: [], permissions: { command: true } })
      .mockResolvedValueOnce({ ok: true, project_id: 'P', operation_id: 'stable-id', command_kind: 'delete_items' });
    const client = createNativeMaterialCommandClient({ uid: () => 'user-1', call, operationId: () => 'stable-id' });

    await expect(client.submit('P', { kind: 'delete_items', item_ids: ['motor'] }, '41:2')).resolves.toMatchObject({ ok: true });
    expect(call).toHaveBeenNthCalledWith(1, { operation: 'get', project_id: 'P' });
    expect(call).toHaveBeenNthCalledWith(2, {
      operation: 'command', project_id: 'P', expected_version: '41:2', expected_actor_uid: 'user-1',
      operation_id: 'stable-id', command: { kind: 'delete_items', item_ids: ['motor'] },
    });
  });

  it('stops when the native version read is denied and never falls back to a legacy write', async () => {
    const call = vi.fn().mockResolvedValue({ ok: false, error: 'material_forbidden' });
    const client = createNativeMaterialCommandClient({ uid: () => 'user-1', call });
    await expect(client.submit('P', { kind: 'delete_items', item_ids: ['motor'] })).rejects.toMatchObject({ code: 'material_forbidden' });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('stops on stale-version conflict without replaying or refreshing and retrying', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true, project_id: 'P', version: '42:7', categories: [], permissions: { command: true } })
      .mockResolvedValueOnce({ ok: false, error: 'material_version_conflict' });
    const client = createNativeMaterialCommandClient({ uid: () => 'user-1', call });
    await expect(client.submit('P', { kind: 'delete_items', item_ids: ['motor'] })).rejects.toMatchObject({ code: 'material_version_conflict' });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('routes receipt entry through the audited native fulfillment endpoint with the displayed revision', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true, project_id: 'P', version: '42:7', categories: [], permissions: { command: true } })
      .mockResolvedValueOnce({ ok: true, project_id: 'P', operation_id: 'receipt-id' });
    const client = createNativeMaterialCommandClient({ uid: () => 'user-1', call, operationId: () => 'receipt-id' });
    await client.fulfill('P', 'motor', { kind: 'receipt', quantity: 1 }, '42:6');
    expect(call).toHaveBeenNthCalledWith(2, {
      operation: 'fulfill', project_id: 'P', item_id: 'motor', expected_version: '42:6',
      expected_actor_uid: 'user-1', operation_id: 'receipt-id', fulfillment: { kind: 'receipt', quantity: 1 },
    });
  });

  it('rejects a session change before sending a write', async () => {
    const call = vi.fn().mockResolvedValue({ ok: true, project_id: 'P', version: '42:7', categories: [], permissions: { command: true } });
    let reads = 0;
    const client = createNativeMaterialCommandClient({ uid: () => reads++ === 0 ? 'user-1' : null, call });
    await expect(client.submit('P', { kind: 'delete_items', item_ids: ['motor'] })).rejects.toThrow('signed-in account');
    expect(call).toHaveBeenCalledTimes(1);
  });
});
