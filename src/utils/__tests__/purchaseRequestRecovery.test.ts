import { beforeEach, expect, it, vi } from 'vitest';
import {
  beginPurchaseRequest,
  readPurchaseRequest,
  clearPurchaseRequest,
  callPurchaseRequest,
  recoverPurchaseRequest,
} from '../purchaseRequestRecovery';
const h = vi.hoisted(() => ({ uid: 'U', call: vi.fn() }));
vi.mock('@/firebase', () => ({
  auth: {
    get currentUser() {
      return h.uid ? { uid: h.uid } : null;
    },
  },
}));
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => h.call,
}));
const locks = {
  request: async <T>(_name: string, work: () => T | Promise<T>): Promise<T> =>
    work(),
};
const body = {
  projectDetails: { projectId: 'P' },
  categories: [{ name: 'Mech', items: [{ id: 'i' }] }],
  recipients: ['a@example.com'],
};
beforeEach(() => {
  localStorage.clear();
  h.uid = 'U';
  h.call.mockReset();
  h.call.mockResolvedValue({
    data: {
      ok: true,
      pending: null,
      project_version: '10:1',
      material_version: '10:1',
    },
  });
});
it('saves a unique actor/project identity before transport and retains it on another attempt', async () => {
  const a = await beginPurchaseRequest('U', 'P', body, { locks });
  const b = await beginPurchaseRequest(
    'U',
    'P',
    { ...body, recipients: ['other@example.com'] },
    { locks }
  );
  expect(a.created).toBe(true);
  expect(b.created).toBe(false);
  expect(b.pending).toEqual(a.pending);
  expect(h.call).toHaveBeenCalledWith({
    operation: 'recover',
    project_id: 'P',
    expected_actor_uid: 'U',
  });
  expect(readPurchaseRequest('U', 'other')).toBe(null);
});
it('storage or cross-tab lock failures prevent transport', async () => {
  await expect(
    beginPurchaseRequest('U', 'P', body, { locks: null })
  ).rejects.toThrow();
  expect(h.call).not.toHaveBeenCalled();
  const bad = {
    getItem: () => null,
    setItem: () => {
      throw Error('quota');
    },
    removeItem: () => {},
  };
  await expect(
    beginPurchaseRequest('U', 'P', body, { locks, storage: bad })
  ).rejects.toThrow();
});
it('corrupt or mismatched saved data is not overwritten', async () => {
  const a = await beginPurchaseRequest('U', 'P', body, { locks });
  const key = localStorage.key(0)!;
  localStorage.setItem(key, 'bad');
  expect(() => readPurchaseRequest('U', 'P')).toThrow();
  await expect(
    beginPurchaseRequest('U', 'P', body, { locks })
  ).rejects.toThrow();
  localStorage.setItem(key, JSON.stringify({ ...a.pending, uid: 'OTHER' }));
  expect(() => readPurchaseRequest('U', 'P')).toThrow();
});
it('retries use the exact saved body and validate the server operation identity', async () => {
  const { pending } = await beginPurchaseRequest('U', 'P', body, { locks });
  h.call.mockClear();
  h.call.mockResolvedValue({
    data: {
      ok: true,
      status: 'uncertain',
      success: false,
      operation_id: pending.body.operation_id,
      can_retry: true,
    },
  });
  await callPurchaseRequest(pending);
  expect(h.call).toHaveBeenCalledWith(pending.body);
  await callPurchaseRequest(pending, true);
  expect(h.call.mock.calls[1][0]).toEqual({
    ...pending.body,
    resolve_only: true,
  });
  h.call.mockResolvedValue({
    data: {
      ok: true,
      status: 'sent',
      success: true,
      operation_id: 'wrong',
      emailId: 'id',
      recipients: [],
    },
  });
  await expect(callPurchaseRequest(pending)).rejects.toThrow();
});
it('legacy success response, provider error and malformed confirmed result never count as success', async () => {
  const { pending } = await beginPurchaseRequest('U', 'P', body, { locks });
  for (const data of [
    { success: true },
    { ok: false, error: 'permission-denied' },
    {
      ok: true,
      success: true,
      status: 'sent',
      operation_id: pending.body.operation_id,
    },
  ]) {
    h.call.mockResolvedValue({ data });
    await expect(callPurchaseRequest(pending)).rejects.toThrow();
  }
  expect(readPurchaseRequest('U', 'P')).toEqual(pending);
});
it('an account switch before or after transport keeps recovery evidence and refuses completion', async () => {
  const { pending } = await beginPurchaseRequest('U', 'P', body, { locks });
  h.call.mockClear();
  h.uid = 'other';
  await expect(callPurchaseRequest(pending)).rejects.toThrow();
  expect(h.call).not.toHaveBeenCalled();
  h.uid = 'U';
  h.call.mockImplementation(async () => {
    h.uid = 'other';
    return {
      data: {
        ok: true,
        success: true,
        status: 'sent',
        operation_id: pending.body.operation_id,
        emailId: 'id',
        recipients: ['a@example.com'],
      },
    };
  });
  await expect(callPurchaseRequest(pending)).rejects.toThrow();
  expect(readPurchaseRequest('U', 'P')).toEqual(pending);
});
it('acknowledgement cannot remove a newer request or another account/project journal', async () => {
  const { pending } = await beginPurchaseRequest('U', 'P', body, { locks });
  await clearPurchaseRequest('U', 'P', 'wrong', { locks });
  expect(readPurchaseRequest('U', 'P')).toEqual(pending);
  await clearPurchaseRequest('U', 'P', pending.body.operation_id as string, {
    locks,
  });
  expect(readPurchaseRequest('U', 'P')).toBe(null);
});

it('rebuilds lost browser evidence only from the authenticated server pending request', async () => {
  h.call.mockResolvedValue({
    data: {
      ok: true,
      pending: {
        ...body,
        operation_id: 'server-1',
        expected_project_version: '10:1',
        expected_material_version: '10:1',
        expected_actor_uid: 'U',
      },
    },
  });
  const p = await recoverPurchaseRequest('U', 'P', { locks });
  expect(p?.body.operation_id).toBe('server-1');
  expect(h.call).toHaveBeenCalledWith({
    operation: 'recover',
    project_id: 'P',
    expected_actor_uid: 'U',
  });
  expect(readPurchaseRequest('U', 'P')).toEqual(p);
});
it('server recovery refuses another owner/project or overwriting a different local request', async () => {
  h.call.mockResolvedValue({
    data: {
      ok: true,
      pending: {
        ...body,
        operation_id: 'server-1',
        expected_project_version: '10:1',
        expected_material_version: '10:1',
        expected_actor_uid: 'OTHER',
      },
    },
  });
  await expect(recoverPurchaseRequest('U', 'P', { locks })).rejects.toThrow();
  expect(readPurchaseRequest('U', 'P')).toBe(null);
  h.call.mockResolvedValue({
    data: {
      ok: true,
      pending: null,
      project_version: '10:1',
      material_version: '10:1',
    },
  });
  const { pending } = await beginPurchaseRequest('U', 'P', body, { locks });
  h.call.mockResolvedValue({
    data: {
      ok: true,
      pending: {
        ...body,
        operation_id: 'server-1',
        expected_project_version: '10:1',
        expected_material_version: '10:1',
        expected_actor_uid: 'U',
      },
    },
  });
  await expect(recoverPurchaseRequest('U', 'P', { locks })).rejects.toThrow();
  expect(readPurchaseRequest('U', 'P')).toEqual(pending);
});

it('explains a current permission refusal without exposing an internal error code', async () => {
  const { pending } = await beginPurchaseRequest('U', 'P', body, { locks });
  h.call.mockRejectedValue({
    code: 'functions/permission-denied',
    message: 'project_forbidden',
  });
  await expect(callPurchaseRequest(pending)).rejects.toThrow(
    'Your current account cannot send purchase requests for this project.'
  );
});

it('new saved requests capture fresh server project/BOM versions before any send', async () => {
  h.call.mockResolvedValue({
    data: {
      ok: true,
      pending: null,
      project_version: '20:2',
      material_version: '30:3',
    },
  });
  const { pending } = await beginPurchaseRequest('U', 'P', body, { locks });
  expect(pending.body.expected_project_version).toBe('20:2');
  expect(pending.body.expected_material_version).toBe('30:3');
  expect(h.call.mock.calls.every((c) => c[0].operation === 'recover')).toBe(
    true
  );
});
it('missing server versions prevent creating a new request identity', async () => {
  h.call.mockResolvedValue({ data: { ok: true, pending: null } });
  await expect(
    beginPurchaseRequest('U', 'P', body, { locks })
  ).rejects.toThrow();
  expect(readPurchaseRequest('U', 'P')).toBe(null);
});
