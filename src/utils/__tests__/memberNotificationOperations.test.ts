import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemberNotificationClient } from '../memberNotificationOperations';

const VERSION = '10:1';
const KEY = 'pulse.member-notification.v1:' + JSON.stringify(['alice', 'P']);
const snapshot = {
  ok: true,
  project_id: 'P',
  version: VERSION,
  preferences: [{ member_uid: 'alice', notifications_enabled: true }, { member_uid: 'bob', notifications_enabled: false }],
};

function fixture() {
  let uid = 'alice';
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
  const calls: Record<string, unknown>[] = [];
  const callable = vi.fn(async (payload: Record<string, unknown>) => {
    calls.push(structuredClone(payload));
    if (payload.operation === 'get') return { data: structuredClone(snapshot) };
    return { data: { ok: true, project_id: 'P', member_uid: payload.member_uid, notifications_enabled: payload.notifications_enabled, operation_id: payload.operation_id, changed: true, resolution: 'committed' } };
  });
  const client = createMemberNotificationClient({ currentUid: async () => uid, callable, storage: () => storage, newOperationId: () => 'nonce-1' });
  return { client, calls, callable, storage, setUid: (next: string) => { uid = next; } };
}

beforeEach(() => { sessionStorage.clear(); });

describe('member notification operations', () => {
  it('accepts existing project IDs longer than member UIDs', async () => {
    const f = fixture();
    const projectId = 'P'.repeat(200);
    f.callable.mockResolvedValueOnce({ data: { ...snapshot, project_id: projectId } });
    await expect(f.client.load(projectId, 'alice')).resolves.toMatchObject({ project_id: projectId });
  });

  it('rejects a stored request whose project or actor disagrees with its storage key', async () => {
    for (const mismatch of [{ project_id: 'Other' }, { expected_actor_uid: 'bob' }]) {
      const f = fixture();
      f.storage.setItem(KEY, JSON.stringify({ operation: 'set', project_id: 'P', member_uid: 'bob', notifications_enabled: false,
        expected_actor_uid: 'alice', expected_version: VERSION, operation_id: 'old', ...mismatch }));
      await expect(f.client.resolvePending('P', 'alice')).rejects.toThrow(/cannot be read/i);
      expect(f.callable).not.toHaveBeenCalled();
    }
  });

  it('a late acknowledgement cannot erase a newer pending request', async () => {
    const f = fixture();
    const replies: Array<(value: any) => void> = [];
    f.callable.mockImplementation(payload => new Promise(resolve => {
      replies.push(() => resolve({ data: { ok: true, project_id: 'P', member_uid: payload.member_uid,
        notifications_enabled: payload.notifications_enabled, operation_id: payload.operation_id, changed: true, resolution: 'committed' } }));
    }));
    const first = f.client.setPreference('P', 'bob', false, VERSION, 'alice');
    const duplicate = f.client.setPreference('P', 'bob', false, VERSION, 'alice');
    await vi.waitFor(() => expect(replies).toHaveLength(2));
    replies[0]({}); await first;
    const newer = f.client.setPreference('P', 'bob', true, '10:2', 'alice');
    await vi.waitFor(() => expect(replies).toHaveLength(3));
    replies[1]({}); await duplicate;
    expect(f.client.hasPending('P', 'alice')).toBe(true);
    expect(JSON.parse(f.storage.getItem(KEY)!)).toMatchObject({ expected_version: '10:2', notifications_enabled: true });
    replies[2]({}); await newer;
  });

  it('loads a versioned, cloned preference snapshot with the expected actor', async () => {
    const f = fixture();
    const result = await f.client.load('P', 'alice');
    expect(result).toEqual(snapshot);
    expect(result).not.toBe(snapshot);
    expect(f.calls[0]).toEqual({ operation: 'get', project_id: 'P', expected_actor_uid: 'alice' });
  });

  it('saves and acknowledges a preference using the displayed revision', async () => {
    const f = fixture();
    await expect(f.client.setPreference('P', 'bob', false, VERSION, 'alice')).resolves.toMatchObject({ changed: true, resolution: 'committed' });
    expect(f.calls[0]).toMatchObject({ operation: 'set', project_id: 'P', member_uid: 'bob', notifications_enabled: false, expected_actor_uid: 'alice', expected_version: VERSION, operation_id: 'nonce-1' });
    expect(f.client.hasPending('P', 'alice')).toBe(false);
  });

  it('clears a pending request after a trusted stale revision refusal', async () => {
    const f = fixture();
    f.callable.mockResolvedValueOnce({ data: { ok: false, error: 'project_version_conflict', status: 409 } });
    await expect(f.client.setPreference('P', 'bob', false, VERSION, 'alice')).rejects.toMatchObject({ code: 'project_version_conflict', status: 409 });
    expect(f.client.hasPending('P', 'alice')).toBe(false);
  });

  it('retains uncertainty and retries the exact saved write and nonce', async () => {
    const f = fixture();
    f.callable.mockRejectedValueOnce(new Error('connection lost'));
    await expect(f.client.setPreference('P', 'bob', false, VERSION, 'alice')).rejects.toThrow(/unconfirmed/i);
    expect(f.client.hasPending('P', 'alice')).toBe(true);
    await f.client.setPreference('P', 'bob', false, VERSION, 'alice');
    expect(f.callable.mock.calls[0][0]).toEqual(f.callable.mock.calls[1][0]);
  });

  it('blocks a changed draft while an earlier write is unresolved', async () => {
    const f = fixture();
    f.callable.mockRejectedValueOnce(new Error('timeout'));
    await expect(f.client.setPreference('P', 'bob', false, VERSION, 'alice')).rejects.toThrow();
    await expect(f.client.setPreference('P', 'bob', true, VERSION, 'alice')).rejects.toThrow(/pending.*request/i);
    expect(f.callable).toHaveBeenCalledTimes(1);
  });

  it('resolves the original saved request with resolve_only and accepts cancellation', async () => {
    const f = fixture();
    f.callable.mockRejectedValueOnce(new Error('timeout'));
    await expect(f.client.setPreference('P', 'bob', false, VERSION, 'alice')).rejects.toThrow();
    f.callable.mockResolvedValueOnce({ data: { ok: true, project_id: 'P', member_uid: 'bob', notifications_enabled: false, operation_id: 'nonce-1', changed: false, resolution: 'cancelled' } });
    await expect(f.client.resolvePending('P', 'alice')).resolves.toMatchObject({ resolution: 'cancelled', changed: false });
    expect(f.callable.mock.calls[1][0]).toEqual({ ...f.callable.mock.calls[0][0], resolve_only: true });
    expect(f.client.hasPending('P', 'alice')).toBe(false);
  });

  it('resolves a saved request as committed without creating a new nonce', async () => {
    const f = fixture();
    f.callable.mockRejectedValueOnce(new Error('timeout'));
    await expect(f.client.setPreference('P', 'bob', false, VERSION, 'alice')).rejects.toThrow();
    f.callable.mockResolvedValueOnce({ data: { ok: true, project_id: 'P', member_uid: 'bob', notifications_enabled: false, operation_id: 'nonce-1', changed: true, resolution: 'committed' } });
    await expect(f.client.resolvePending('P', 'alice')).resolves.toMatchObject({ resolution: 'committed', changed: true });
    expect(f.callable.mock.calls[1][0]).toMatchObject({ operation_id: 'nonce-1', expected_version: VERSION, resolve_only: true });
  });

  it('keeps scope isolated by actor and project', async () => {
    const f = fixture();
    f.callable.mockRejectedValueOnce(new Error('timeout'));
    await expect(f.client.setPreference('P', 'bob', false, VERSION, 'alice')).rejects.toThrow();
    expect(f.client.hasPending('P', 'alice')).toBe(true);
    expect(f.client.hasPending('Other', 'alice')).toBe(false);
    expect(f.client.hasPending('P', 'bob')).toBe(false);
  });

  it('does not dispatch after the account or asserted context changes', async () => {
    const f = fixture();
    f.setUid('bob');
    await expect(f.client.load('P', 'alice')).rejects.toThrow(/account changed/i);
    expect(f.calls).toHaveLength(0);
    f.setUid('alice');
    let valid = false;
    await expect(f.client.load('P', 'alice', () => { if (!valid) throw new Error('context changed'); })).rejects.toThrow(/context changed/i);
    expect(f.calls).toHaveLength(0);
  });

  it('retains the saved request when account or context changes during the callable', async () => {
    const f = fixture();
    f.callable.mockImplementationOnce(async (payload) => {
      f.setUid('bob');
      return { data: { ok: true, project_id: 'P', member_uid: payload.member_uid, notifications_enabled: payload.notifications_enabled, operation_id: payload.operation_id, changed: true, resolution: 'committed' } };
    });
    await expect(f.client.setPreference('P', 'bob', false, VERSION, 'alice')).rejects.toThrow(/account changed/i);
    expect(f.client.hasPending('P', 'alice')).toBe(true);

    f.setUid('alice');
    let valid = true;
    f.callable.mockImplementationOnce(async (payload) => {
      valid = false;
      return { data: { ok: true, project_id: 'P', member_uid: payload.member_uid, notifications_enabled: payload.notifications_enabled, operation_id: payload.operation_id, changed: true, resolution: 'committed' } };
    });
    await expect(f.client.setPreference('P', 'bob', false, VERSION, 'alice', () => { if (!valid) throw new Error('context changed'); })).rejects.toThrow(/context changed/i);
    expect(f.client.hasPending('P', 'alice')).toBe(true);
  });

  it('fails closed on corrupt or unavailable pending storage', async () => {
    const f = fixture();
    f.storage.getItem.mockReturnValueOnce('{bad');
    expect(() => f.client.hasPending('P', 'alice')).toThrow(/cannot be read/i);
    f.storage.setItem.mockImplementationOnce(() => { throw new Error('blocked'); });
    await expect(f.client.setPreference('P', 'bob', false, VERSION, 'alice')).rejects.toThrow(/session storage/i);
    expect(f.calls).toHaveLength(0);
  });

  it('retains a request when the server reply is malformed or mismatched', async () => {
    const f = fixture();
    f.callable.mockResolvedValueOnce({ data: { ok: true, project_id: 'P', member_uid: 'bob', notifications_enabled: true, operation_id: 'wrong', changed: true, resolution: 'committed' } });
    await expect(f.client.setPreference('P', 'bob', false, VERSION, 'alice')).rejects.toThrow(/unexpected/i);
    expect(f.client.hasPending('P', 'alice')).toBe(true);
  });
});
