import { beforeEach, describe, expect, it, vi } from 'vitest';

const { httpsCallableMock, callableResult } = vi.hoisted(() => ({
  httpsCallableMock: vi.fn(),
  callableResult: vi.fn(),
}));

let operationSequence = 0;
const firstOperationId = '550e8400-e29b-41d4-a716-446655440000';
const secondOperationId = '550e8400-e29b-41d4-a716-446655440001';
const thirdOperationId = '550e8400-e29b-41d4-a716-446655440002';
const fourthOperationId = '550e8400-e29b-41d4-a716-446655440003';

vi.mock('firebase/functions', () => ({
  httpsCallable: httpsCallableMock,
}));

vi.mock('@/firebase', () => ({ functions: {} }));

import { triggerSpecSearch } from './complianceService';

describe('triggerSpecSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    operationSequence = 0;
    vi.stubGlobal('crypto', {
      randomUUID: () => [firstOperationId, secondOperationId, thirdOperationId, fourthOperationId][operationSequence++],
    });
    vi.restoreAllMocks();
    window.localStorage.clear();
    httpsCallableMock.mockReturnValue(callableResult);
    callableResult.mockResolvedValue({
      data: {
        ok: true,
        operation_id: firstOperationId,
        state: 'completed',
        specificationUrl: 'https://vendor.example/spec.pdf',
      },
    });
  });

  it('dispatches through the protected callable using only project, item, operation, and authenticated actor IDs', async () => {
    await triggerSpecSearch({
      bomItemId: 'item-1',
      projectId: 'project-1',
      itemName: 'Valve',
      make: 'Acme',
      sku: 'V-100',
      userId: 'firebase-uid-1',
    });

    expect(httpsCallableMock).toHaveBeenCalledWith({}, 'nativeSpecSearchOperation');
    expect(callableResult).toHaveBeenCalledWith({
      project_id: 'project-1',
      item_id: 'item-1',
      operation_id: firstOperationId,
      expected_actor_uid: 'firebase-uid-1',
    });
  });

  it('maps the protected completed result to the existing button response shape', async () => {
    const response = await triggerSpecSearch({
      bomItemId: 'item-1',
      projectId: 'project-1',
      itemName: 'Valve',
      userId: 'firebase-uid-1',
    });

    expect(response).toMatchObject({
      success: true,
      searchId: firstOperationId,
      status: 'completed',
      specificationUrl: 'https://vendor.example/spec.pdf',
    });
  });

  it('reuses the same operation ID after a lost response', async () => {
    callableResult
      .mockRejectedValueOnce(new Error('network response was lost'))
      .mockResolvedValueOnce({ data: {
        ok: true,
        operation_id: firstOperationId,
        state: 'completed',
        specificationUrl: 'https://vendor.example/spec.pdf',
      } });
    const request = {
      bomItemId: 'item-1',
      projectId: 'retry-project',
      itemName: 'Valve',
      userId: 'retry-user',
    };

    await expect(triggerSpecSearch(request)).rejects.toThrow('network response was lost');
    expect(JSON.parse(window.localStorage.getItem('bom:spec-search:pending:retry-user:retry-project:item-1') || '{}'))
      .toEqual({ operationId: firstOperationId, state: 'pending' });
    await triggerSpecSearch(request);

    expect(window.localStorage.getItem('bom:spec-search:pending:retry-user:retry-project:item-1'))
      .toBeNull();
    expect(callableResult.mock.calls.map(([payload]) => payload.operation_id))
      .toEqual([firstOperationId, firstOperationId]);
  });

  it('allows a fresh operation after a terminal response', async () => {
    const request = {
      bomItemId: 'item-1',
      projectId: 'terminal-project',
      itemName: 'Valve',
      userId: 'terminal-user',
    };
    await triggerSpecSearch(request);
    callableResult.mockResolvedValue({ data: {
      ok: true,
      operation_id: secondOperationId,
      state: 'completed',
      specificationUrl: 'https://vendor.example/spec.pdf',
    } });
    await triggerSpecSearch(request);

    expect(callableResult.mock.calls.map(([payload]) => payload.operation_id))
      .toEqual([firstOperationId, secondOperationId]);
  });

  it('fails closed without calling the server when the pending ID cannot be saved', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage quota unavailable');
    });

    await expect(triggerSpecSearch({
      bomItemId: 'item-1',
      projectId: 'project-1',
      itemName: 'Valve',
      userId: 'firebase-uid-1',
    })).rejects.toThrow(/save.*retry|browser storage/i);

    expect(callableResult).not.toHaveBeenCalled();
  });

  it('blocks another search until a terminal retry record can be cleared', async () => {
    const request = {
      bomItemId: 'item-1',
      projectId: 'cleanup-project',
      itemName: 'Valve',
      userId: 'cleanup-user',
    };
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage cleanup unavailable');
    });

    await triggerSpecSearch(request);
    await expect(triggerSpecSearch(request)).rejects.toThrow(/previous search.*storage|clear.*search/i);
    expect(callableResult).toHaveBeenCalledTimes(1);

    removeItem.mockRestore();
    await triggerSpecSearch(request);

    expect(callableResult.mock.calls.map(([payload]) => payload.operation_id))
      .toEqual([firstOperationId, secondOperationId]);
  });

  it('retries the same receipt if saving the terminal marker fails', async () => {
    const request = {
      bomItemId: 'item-1',
      projectId: 'terminal-save-project',
      itemName: 'Valve',
      userId: 'terminal-save-user',
    };
    const originalSetItem = Storage.prototype.setItem.bind(window.localStorage);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      if (JSON.parse(String(value)).state === 'terminal') throw new Error('storage write failed');
      originalSetItem(key, String(value));
    });

    await expect(triggerSpecSearch(request)).rejects.toThrow(/completion record/i);
    setItem.mockRestore();
    await triggerSpecSearch(request);

    expect(callableResult.mock.calls.map(([payload]) => payload.operation_id))
      .toEqual([firstOperationId, firstOperationId]);
    expect(window.localStorage.length).toBe(0);
  });

  it('isolates pending IDs by actor, project, and item', async () => {
    callableResult.mockRejectedValueOnce(new Error('uncertain 1'))
      .mockRejectedValueOnce(new Error('uncertain 2'))
      .mockRejectedValueOnce(new Error('uncertain 3'))
      .mockRejectedValueOnce(new Error('uncertain 4'));
    const requests = [
      { bomItemId: 'item-1', projectId: 'project-1', itemName: 'Valve', userId: 'user-1' },
      { bomItemId: 'item-2', projectId: 'project-1', itemName: 'Valve', userId: 'user-1' },
      { bomItemId: 'item-1', projectId: 'project-2', itemName: 'Valve', userId: 'user-1' },
      { bomItemId: 'item-1', projectId: 'project-1', itemName: 'Valve', userId: 'user-2' },
    ];

    for (let index = 0; index < requests.length; index++) {
      await expect(triggerSpecSearch(requests[index])).rejects.toThrow(`uncertain ${index + 1}`);
    }

    expect(callableResult.mock.calls.map(([payload]) => payload.operation_id))
      .toEqual([firstOperationId, secondOperationId, thirdOperationId, fourthOperationId]);
    expect(window.localStorage.length).toBe(4);
  });
});
